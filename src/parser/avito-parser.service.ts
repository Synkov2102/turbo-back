/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { Browser, Page } from 'puppeteer';
import { Car, CarDocument } from '../schemas/car.schema';
import { CaptchaService } from './captcha.service';
import {
  createBrowser,
  createPage,
  setupPage,
  navigateWithRetry,
  isIpBlocked,
  randomDelay,
  normalizeAvitoUrl,
} from './utils/browser-helper';

interface ExtractedData {
  title: string;
  price: {
    RUB?: number;
    USD?: number;
    EUR?: number;
  };
  description: string;
  brand: string;
  model: string;
  year: number;
  mileage: number;
  location: {
    city?: string;
    country?: string;
  };
  transmission: string;
  engineVolume: number;
  images: string[];
}

@Injectable()
export class AvitoParserService {
  constructor(
    @InjectModel(Car.name) private carModel: Model<CarDocument>,
    private readonly captchaService: CaptchaService,
  ) {}

  /**
   * Парсит фотографии через модальное окно для получения лучшего качества
   */
  private async parseImagesFromModal(page: Page): Promise<string[]> {
    const images: string[] = [];
    const seen = new Set<string>();

    try {
      // Находим первое фото и кликаем на него
      const firstImageSelector =
        '[data-marker="image-frame/image"] img, [data-marker="image-viewer/image"] img, img[itemprop="image"], .gallery-img, img.desktop-1ky5g7j';

      const firstImage = await page.$(firstImageSelector);
      if (!firstImage) {
        console.log('[AvitoParser] First image not found, trying fallback...');
        // Fallback: собираем все видимые изображения
        const allImages = await page.evaluate(() => {
          const images: string[] = [];
          const seen = new Set<string>();
          const imgElements = document.querySelectorAll(
            '[data-marker="image-frame/image"] img, [itemprop="image"]',
          );
          imgElements.forEach((img) => {
            const src =
              (img as HTMLImageElement).src ||
              img.getAttribute('src') ||
              img.getAttribute('data-src');
            if (src && !seen.has(src)) {
              images.push(src);
              seen.add(src);
            }
          });
          return images;
        });
        return allImages;
      }

      // Кликаем на первое фото для открытия модального окна
      console.log('[AvitoParser] Clicking on first image to open modal...');
      await firstImage.click();
      await randomDelay(1500, 2000);

      // Ждем появления модального окна
      try {
        await page.waitForSelector(
          '[data-marker="extended-gallery/frame-wrapper"], [data-marker="extended-gallery/frame-img"], [data-marker="extended-gallery-frame"], [data-marker="image-viewer"], [class*="gallery"] img, [class*="image-viewer"] img',
          { timeout: 3000 },
        );
      } catch {
        console.log('[AvitoParser] Modal did not open, using fallback method');
        return await this.parseImagesFallback(page);
      }

      // Парсим фото из модального окна
      // Сначала парсим первое фото, которое уже открыто
      const parseCurrentImage = async (): Promise<string | null> => {
        return await page.evaluate(() => {
          // Ищем ТОЛЬКО изображения из extended-gallery/frame-wrapper
          // Это единственный правильный источник для фото в модальном окне
          const frameWrapper = document.querySelector(
            '[data-marker="extended-gallery/frame-wrapper"]',
          );

          if (!frameWrapper) {
            console.log(
              '[AvitoParser] Frame wrapper not found, cannot parse image',
            );
            return null;
          }

          // Ищем изображение внутри wrapper с правильным data-marker
          const currentImage = frameWrapper.querySelector(
            'img[data-marker="extended-gallery/frame-img"]',
          );

          if (!currentImage) {
            console.log(
              '[AvitoParser] Image not found in frame wrapper or has no src',
            );
            return null;
          }

          const imageElement = currentImage as HTMLImageElement;
          if (!imageElement.src) {
            console.log(
              '[AvitoParser] Image not found in frame wrapper or has no src',
            );
            return null;
          }

          // Проверяем, что это действительно изображение с валидным src
          const src =
            imageElement.getAttribute('src') || imageElement.currentSrc;
          if (!src || !src.includes('avito')) {
            console.log('[AvitoParser] Invalid image src:', src);
            return null;
          }

          // Проверяем размеры изображения - фильтруем маленькие фото
          const width = imageElement.naturalWidth || imageElement.width || 0;
          const height = imageElement.naturalHeight || imageElement.height || 0;

          // Пропускаем маленькие изображения (меньше 200x200 пикселей)
          // Это могут быть превью, иконки или миниатюры
          if (width > 0 && height > 0 && (width < 200 || height < 200)) {
            console.log(
              `[AvitoParser] Skipping small image: ${width}x${height} - ${src.substring(0, 80)}`,
            );
            return null;
          }

          // Пробуем получить URL высокого качества из разных атрибутов
          // Приоритет: src (в extended-gallery обычно уже оригинал) > data-src > currentSrc
          // В extended-gallery/frame-img атрибут src обычно уже содержит оригинальное изображение
          let imageUrl =
            imageElement.getAttribute('src') ||
            imageElement.getAttribute('data-src') ||
            imageElement.getAttribute('data-lazy-src') ||
            imageElement.getAttribute('data-original') ||
            imageElement.currentSrc ||
            '';

          if (imageUrl) {
            // Проверяем размеры изображения из URL или атрибутов
            // Фильтруем маленькие изображения (превью, миниатюры)
            const widthAttr = imageElement.getAttribute('width');
            const heightAttr = imageElement.getAttribute('height');
            const naturalWidth = imageElement.naturalWidth || 0;
            const naturalHeight = imageElement.naturalHeight || 0;

            // Проверяем размеры из URL (например, /640x480/ или ?size=640x480)
            const sizeMatch =
              imageUrl.match(/\/(\d+)x(\d+)\//) ||
              imageUrl.match(/[?&]size=(\d+)x(\d+)/);
            let urlWidth = 0;
            let urlHeight = 0;
            if (sizeMatch) {
              urlWidth = parseInt(sizeMatch[1], 10);
              urlHeight = parseInt(sizeMatch[2], 10);
            }

            // Определяем реальные размеры изображения
            const actualWidth =
              naturalWidth ||
              (widthAttr ? parseInt(widthAttr, 10) : 0) ||
              urlWidth ||
              0;
            const actualHeight =
              naturalHeight ||
              (heightAttr ? parseInt(heightAttr, 10) : 0) ||
              urlHeight ||
              0;

            // Пропускаем маленькие изображения (меньше 200x200 пикселей)
            // Это могут быть превью, иконки, миниатюры или thumbnail'ы
            if (
              actualWidth > 0 &&
              actualHeight > 0 &&
              (actualWidth < 200 || actualHeight < 200)
            ) {
              console.log(
                `Skipping small image: ${actualWidth}x${actualHeight} - ${imageUrl.substring(0, 80)}`,
              );
              return null;
            }

            // Нормализуем URL для получения максимального качества
            // Убираем параметры размера, но сохраняем структуру URL
            imageUrl = imageUrl
              .replace(/\/\d+x\d+\//, '/') // Убираем размеры типа /640x480/
              .replace(/[?&]size=\d+x\d+/, '') // Убираем параметр size
              .replace(/[?&]width=\d+/, '') // Убираем width
              .replace(/[?&]height=\d+/, '') // Убираем height
              .replace(/[?&]quality=\d+/, ''); // Убираем quality

            // Убираем tracking параметры
            // Пробуем использовать URL объект для правильной обработки параметров
            try {
              const fullUrl = imageUrl.startsWith('http')
                ? imageUrl
                : imageUrl.startsWith('//')
                  ? 'https:' + imageUrl
                  : 'https://www.avito.ru' + imageUrl;
              const urlObj = new URL(fullUrl);

              // Удаляем только tracking параметры
              urlObj.searchParams.delete('cqp');
              urlObj.searchParams.delete('utm_source');
              urlObj.searchParams.delete('utm_medium');
              urlObj.searchParams.delete('utm_campaign');

              imageUrl = urlObj.toString();
            } catch {
              // Если не удалось распарсить URL, используем простую замену
              imageUrl = imageUrl
                .replace(/[?&]cqp=[^&]*/, '')
                .replace(/[?&]utm_source=[^&]*/, '')
                .replace(/[?&]utm_medium=[^&]*/, '')
                .replace(/[?&]utm_campaign=[^&]*/, '');
            }

            // Если URL все еще содержит параметры размера, пробуем получить базовый URL
            // Но только если это не оригинальное изображение
            if (
              imageUrl.includes('?') &&
              (imageUrl.includes('size=') || imageUrl.includes('width='))
            ) {
              // Пробуем найти базовый URL без параметров
              const baseUrl = imageUrl.split('?')[0];
              // Проверяем, что это валидный URL изображения Avito
              if (
                baseUrl.includes('avito') &&
                (baseUrl.endsWith('.jpg') ||
                  baseUrl.endsWith('.jpeg') ||
                  baseUrl.endsWith('.png') ||
                  baseUrl.includes('/image/'))
              ) {
                imageUrl = baseUrl;
              }
            }

            // Делаем URL полным
            if (imageUrl.startsWith('//')) {
              imageUrl = 'https:' + imageUrl;
            } else if (imageUrl.startsWith('/')) {
              imageUrl = 'https://www.avito.ru' + imageUrl;
            }

            // Убираем лишние параметры из финального URL для получения оригинала
            // Avito использует структуру типа: /image/1/1.xxx?cqp=...
            // Для оригинала можно попробовать убрать все параметры
            if (imageUrl.includes('/image/') && imageUrl.includes('?')) {
              const imageBaseUrl = imageUrl.split('?')[0];
              // Используем базовый URL без параметров для максимального качества
              imageUrl = imageBaseUrl;
            }
          }

          return imageUrl;
        });
      };

      // Парсим первое фото
      const firstImageData = await parseCurrentImage();
      if (firstImageData && !seen.has(firstImageData)) {
        images.push(firstImageData);
        seen.add(firstImageData);
        console.log(
          `[AvitoParser] Found image ${images.length}: ${firstImageData.substring(0, 80)}...`,
        );
      }

      let lastImageUrl = firstImageData || '';
      let attempts = 0;
      const maxAttempts = 50;

      // Теперь листаем остальные фото
      while (attempts < maxAttempts) {
        // Сохраняем текущее изображение ПЕРЕД кликом на кнопку
        // Это нужно для проверки, что изображение действительно изменилось
        const currentImageBeforeClick = await parseCurrentImage();
        if (!currentImageBeforeClick) {
          console.log(
            '[AvitoParser] Cannot find current image, stopping image collection',
          );
          break;
        }

        // Ищем и кликаем кнопку "вперед" (правильный селектор для Avito)
        const nextButtonSelectors = [
          '[data-marker="extended-gallery-frame/control-right"] button',
          '[data-marker="extended-gallery-frame/control-right"]',
          '[data-marker="image-viewer/right-button"] button',
          '[data-marker="image-viewer/right-button"]',
          '[class*="control-button-right"] button',
          '[class*="control-button"] [class*="right"] button',
          'button[aria-label*="следующ"]',
          'button[aria-label*="next"]',
        ];

        let nextButton: Awaited<ReturnType<typeof page.$>> = null;
        for (const selector of nextButtonSelectors) {
          nextButton = await page.$(selector);
          if (nextButton) {
            // Проверяем, активна ли кнопка (не disabled)
            const isEnabled = await page.evaluate((sel) => {
              const btn = document.querySelector(sel);
              if (!btn) return false;
              return (
                !btn.hasAttribute('disabled') &&
                !btn.classList.contains('disabled') &&
                btn.getAttribute('aria-disabled') !== 'true'
              );
            }, selector);

            if (isEnabled) {
              console.log(
                `[AvitoParser] Found next button with selector: ${selector}`,
              );
              break;
            } else {
              nextButton = null; // Кнопка найдена, но неактивна
            }
          }
        }

        if (!nextButton) {
          console.log(
            '[AvitoParser] Next button not found or disabled, stopping image collection',
          );
          break;
        }

        // Кликаем на кнопку
        await nextButton.click();
        // Ждем загрузки следующего изображения
        await randomDelay(1000, 1500);

        // Парсим новое изображение ПОСЛЕ клика
        const newImageData = await parseCurrentImage();

        // Если изображение не найдено, значит достигли конца
        if (!newImageData) {
          console.log(
            '[AvitoParser] No image found after click, reached the end',
          );
          break;
        }

        // Проверяем, что изображение действительно изменилось
        // Если изображение не изменилось, значит мы уже на последнем фото
        if (newImageData === currentImageBeforeClick) {
          console.log(
            '[AvitoParser] Image did not change after click, reached the end',
          );
          break;
        }

        // Проверяем, что это не дубликат уже добавленного изображения
        if (newImageData === lastImageUrl || seen.has(newImageData)) {
          console.log(
            '[AvitoParser] Duplicate image detected (already in list), stopping',
          );
          break;
        }

        // Добавляем новое изображение
        images.push(newImageData);
        seen.add(newImageData);
        lastImageUrl = newImageData;
        console.log(
          `[AvitoParser] Found image ${images.length}: ${newImageData.substring(0, 80)}...`,
        );

        attempts++;
      }

      // Закрываем модальное окно
      const closeButtonSelectors = [
        '[data-marker="image-viewer/close-button"] button',
        '[data-marker="image-viewer/close-button"]',
        'button[aria-label*="закрыть"]',
        'button[aria-label*="close"]',
      ];

      for (const selector of closeButtonSelectors) {
        const closeButton = await page.$(selector);
        if (closeButton) {
          await closeButton.click();
          await randomDelay(500, 800);
          break;
        }
      }

      console.log(`[AvitoParser] Collected ${images.length} images from modal`);
      return images;
    } catch (error) {
      console.error('[AvitoParser] Error parsing images from modal:', error);
      return await this.parseImagesFallback(page);
    }
  }

  /**
   * Fallback метод для парсинга фотографий (старый способ)
   */
  private async parseImagesFallback(page: Page): Promise<string[]> {
    const images: string[] = [];
    const seen = new Set<string>();

    const imageData = await page.evaluate(() => {
      const images: string[] = [];
      const seen = new Set<string>();

      const currentSrc = document
        .querySelector('img.desktop-1ky5g7j')
        ?.getAttribute('src');
      if (currentSrc) {
        images.push(currentSrc);
        seen.add(currentSrc);
      }

      return { images, seen };
    });

    images.push(...imageData.images);
    imageData.seen.forEach((url) => seen.add(url));

    // Пробуем листать фото через кнопки
    let attempts = 0;
    while (attempts < 20) {
      const button = await page.$(
        '[data-marker="image-frame/right-button"] button',
      );
      if (!button) break;

      await button.click();
      await randomDelay(1000, 1500);

      const newSrc = await page.evaluate(() => {
        return document
          .querySelector('img.desktop-1ky5g7j')
          ?.getAttribute('src');
      });

      if (!newSrc || seen.has(newSrc)) break;
      images.push(newSrc);
      seen.add(newSrc);
      attempts++;
    }

    return images;
  }

  async parseAndSave(url: string): Promise<Car> {
    // Валидация URL - проверяем что это Avito
    if (!url.includes('avito.ru')) {
      throw new Error('URL должен быть с домена avito.ru');
    }

    // Нормализуем URL, удаляя параметры отслеживания (context, utm_* и т.д.)
    const normalizedUrl = normalizeAvitoUrl(url);
    if (normalizedUrl !== url) {
      console.log(
        `[AvitoParser] URL normalized: ${url.substring(0, 80)}... -> ${normalizedUrl.substring(0, 80)}...`,
      );
    }

    let browser: Browser | undefined;
    let page: Page | undefined;

    try {
      console.log('[AvitoParser] Launching browser...');
      browser = await createBrowser(false); // пользователь сможет сам решить капчу

      page = await createPage(browser, true); // Создаем страницу в инкогнито
      await setupPage(page);

      page.on('console', (msg) => console.log('[PAGE LOG]:', msg.text()));

      console.log('[AvitoParser] Navigating to URL:', normalizedUrl);
      // Используем улучшенную навигацию с retry и автоматическим решением капчи
      const navigated = await navigateWithRetry(
        page,
        normalizedUrl,
        3,
        this.captchaService,
      );
      if (!navigated) {
        throw new Error('Failed to navigate to page after retries');
      }

      // Проверяем, не заблокирован ли IP
      const blocked = await isIpBlocked(page);
      if (blocked) {
        console.warn(
          '[AvitoParser] IP blocked detected. Waiting for manual resolution...',
        );
        // Ждем, пока пользователь решит проблему (до 10 минут)
        await page.waitForFunction(
          () => {
            const bodyText = (document.body?.textContent || '').toLowerCase();
            return (
              !bodyText.includes('проблема с ip') && !bodyText.includes('капча')
            );
          },
          { timeout: 600000 }, // 10 минут
        );
      }

      console.log('[AvitoParser] Page loaded, current URL:', page.url());

      // Немного подождать динамику
      await randomDelay(2000, 4000);

      // ----- КЛЮЧЕВОЙ БЛОК: проверка капчи и "страницы не авто" -----
      const initialState = await page.evaluate(() => {
        const hasCaptcha =
          !!document.querySelector('.captcha') ||
          !!document.querySelector('[data-marker*="captcha"]') ||
          document.title.toLowerCase().includes('captcha') ||
          (document.body?.textContent || '').toLowerCase().includes('капча');

        // Очень грубый признак страницы объявления:
        // есть заголовок и цена
        const hasCarTitle = !!document.querySelector('h1');
        const hasCarPrice = !!document.querySelector('[itemprop="price"]');
        const isCarPage = hasCarTitle && hasCarPrice;

        return {
          hasCaptcha,
          isCarPage,
        };
      });

      console.log('Initial state:', initialState);

      if (initialState.hasCaptcha || !initialState.isCarPage) {
        console.log(
          'Похоже, открылось не объявление (капча или другая страница). Ждём, пока пользователь решит капчу/откроет объявление...',
        );

        // Здесь пользователь вручную решает капчу / открывает нужное объявление
        // Мы просто ждём, пока одновременно:
        // - пропадёт капча
        // - и появятся элементы объявления (заголовок и цена)
        await page.waitForFunction(
          () => {
            const bodyText = document.body?.textContent?.toLowerCase() || '';

            const noCaptcha =
              !bodyText.includes('captcha') &&
              !bodyText.includes('капча') &&
              !document.querySelector('.captcha') &&
              !document.querySelector('[data-marker*="captcha"]') &&
              !document.title.toLowerCase().includes('captcha');

            const hasCarTitle = !!document.querySelector('h1');
            const hasCarPrice = !!document.querySelector('[itemprop="price"]');
            const isCarPage = hasCarTitle && hasCarPrice;

            return noCaptcha && isCarPage;
          },
          {
            timeout: 10 * 60 * 1000, // до 10 минут на ручное решение / навигацию
          },
        );

        console.log(
          'Капча решена или открыта страница объявления. Продолжаем парсинг...',
        );

        // ещё немного подождать, чтобы всё дорендерилось
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }

      // ----- дальше идёт твой текущий парсинг -----

      const bodyText = await page.evaluate(
        () => document.body?.textContent?.substring(0, 200) || 'No body',
      );
      console.log('Page body preview:', bodyText);

      const fullHtml = await page.evaluate(
        () =>
          document.documentElement?.outerHTML?.substring(0, 1000) || 'No HTML',
      );
      console.log('Page HTML preview:', fullHtml);

      // Парсим фотографии через модальное окно для получения лучшего качества
      const images = await this.parseImagesFromModal(page);

      const data = await page.evaluate(async () => {
        console.log('Starting data extraction...');

        const itempropElements = document.querySelectorAll('[itemprop]');
        console.log('itemprop elements found:', itempropElements.length);
        itempropElements.forEach((el, i) => {
          const itemprop = el.getAttribute('itemprop');
          const content = el.textContent?.trim().substring(0, 50);
          console.log(`itemprop ${i}: ${itemprop} = "${content}"`);
        });

        const title =
          document.querySelector('h1')?.textContent?.trim() || 'Unknown';

        const priceElement = document.querySelector('[itemprop="price"]');
        const priceText =
          priceElement?.getAttribute('content') ||
          priceElement?.textContent?.trim() ||
          '';
        const priceValue = parseInt(priceText.replace(/\D/g, '')) || 0;

        // Определяем валюту по тексту цены
        const priceTextLower = priceText.toLowerCase();
        const price: { RUB?: number; USD?: number; EUR?: number } = {};

        if (
          priceTextLower.includes('$') ||
          priceTextLower.includes('usd') ||
          priceTextLower.includes('долл')
        ) {
          price.USD = priceValue;
        } else if (
          priceTextLower.includes('€') ||
          priceTextLower.includes('eur') ||
          priceTextLower.includes('евро')
        ) {
          price.EUR = priceValue;
        } else {
          // По умолчанию рубли (Avito обычно в рублях)
          price.RUB = priceValue;
        }

        const descriptionElement = document.querySelector(
          '[itemprop="description"]',
        );
        const description =
          descriptionElement?.textContent?.trim() ||
          document
            .querySelector('[data-marker="item-view/item-description"]')
            ?.textContent?.trim() ||
          document
            .querySelector('.item-description-text')
            ?.textContent?.trim() ||
          '';

        const brandElement = document.querySelector('[itemprop="brand"]');
        let brand = brandElement?.textContent?.trim() || '';

        const breadcrumbElements = document.querySelectorAll(
          '#bx_item-breadcrumbs [itemprop="itemListElement"]',
        );
        if (breadcrumbElements.length >= 5) {
          const brandSpan =
            breadcrumbElements[4].querySelector('[itemprop="name"]');
          brand = brandSpan?.textContent?.trim() || brand;
        }

        if (!brand) {
          const words = title.split(/\s+/);
          if (words.length > 0) brand = words[0];
          if (words.length > 1 && !/\d/.test(words[1])) {
            brand += ' ' + words[1];
          }
        }

        const modelElement = document.querySelector('[itemprop="model"]');
        let model = modelElement?.textContent?.trim() || '';

        if (breadcrumbElements.length >= 6) {
          const modelSpan =
            breadcrumbElements[5].querySelector('[itemprop="name"]');
          model = modelSpan?.textContent?.trim() || model;
        }

        if (!model) {
          const words = title.split(/\s+/);
          const modelIndex = brand.split(' ').length;
          if (words.length > modelIndex) {
            model = words[modelIndex];
          }
        }


        const yearElement = document.querySelector(
          '[itemprop="productionDate"]',
        );
        const yearText =
          yearElement?.getAttribute('content') ||
          yearElement?.textContent?.trim() ||
          '';
        let year = parseInt(yearText) || 0;

        if (!year) {
          const yearLi = document.querySelector('li.cHzV4');
          if (yearLi && yearLi.textContent?.includes('Год выпуска')) {
            const yearMatch = yearLi.textContent.match(/Год выпуска.*?(\d{4})/);
            if (yearMatch) year = parseInt(yearMatch[1]);
          }
        }

        if (!year) {
          const yearMatch = title.match(/\b(20\d{2})\b/);
          if (yearMatch) year = parseInt(yearMatch[1]);
        }

        const mileageElement = document.querySelector(
          '[itemprop="mileageFromOdometer"]',
        );
        const mileageText =
          mileageElement?.getAttribute('content') ||
          mileageElement?.textContent?.trim() ||
          '';
        let mileage = parseInt(mileageText.replace(/\D/g, '')) || 0;

        if (!mileage) {
          const mileagePatterns = [
            /(\d{1,3}(?:\s?\d{3})*)\s?км/i,
            /(\d{1,3}(?:\s?\d{3})*)\s?km/i,
            /(\d{1,3})\s?тыс\.?\s?км/i,
            /(\d{1,3})\s?тыс\.?\s?km/i,
          ];

          for (const pattern of mileagePatterns) {
            const mileageMatch = title.match(pattern);
            if (mileageMatch) {
              let parsedMileage = parseInt(mileageMatch[1].replace(/\s/g, ''));
              if (pattern.source.includes('тыс')) {
                parsedMileage *= 1000;
              }
              mileage = parsedMileage;
              break;
            }
          }
        }

        const cityElement = document.querySelector(
          '[itemprop="addressLocality"]',
        );
        const cityRawText =
          cityElement?.textContent?.trim() ||
          document
            .querySelector('[data-marker="item-view/item-address"]')
            ?.textContent?.trim() ||
          document
            .querySelector('.item-address__string')
            ?.textContent?.trim() ||
          document
            .querySelector('[class*="style__item-address__string"]')
            ?.textContent?.trim() ||
          '';

        let city = 'Unknown';
        if (cityRawText) {
          const cityPart = cityRawText.split(',')[0].trim();
          city = cityPart || cityRawText;
        }

        // Определяем страну (по умолчанию Россия для Avito)
        const country = 'Россия';

        let transmission = '';
        let yearFromTitle = 0;

        const transmissionPatterns = [
          { pattern: /\b(АТ)\b/i, type: 'AT' },
          { pattern: /\b(AT)\b/i, type: 'AT' },
          { pattern: /\b(МТ)\b/i, type: 'MT' },
          { pattern: /\b(MT)\b/i, type: 'MT' },
          { pattern: /\b(АМТ)\b/i, type: 'AMT' },
          { pattern: /\b(AMT)\b/i, type: 'AMT' },
          { pattern: /\b(ЦВТ)\b/i, type: 'CVT' },
          { pattern: /\b(CVT)\b/i, type: 'CVT' },
          { pattern: /\b(автомат)\b/i, type: 'AT' },
          { pattern: /\b(механика)\b/i, type: 'MT' },
          { pattern: /\b(вариатор)\b/i, type: 'CVT' },
          { pattern: /\b(робот)\b/i, type: 'AMT' },
        ];

        for (const { pattern, type } of transmissionPatterns) {
          const match = title.match(pattern);
          if (match) {
            transmission = type;
            break;
          }
        }

        const yearMatches = title.match(/\b(19\d{2}|20\d{2})\b/g);
        if (yearMatches) {
          for (const yearStr of yearMatches) {
            const foundYear = parseInt(yearStr);
            if (
              foundYear >= 1900 &&
              foundYear <= new Date().getFullYear() + 2
            ) {
              yearFromTitle = foundYear;
            }
          }
        }

        if (yearFromTitle > 0) {
          year = yearFromTitle;
        }

        let engineVolume = 0;
        const engineVolumePattern = /\b(\d{1,2}\.\d{1})\b/;
        const engineMatch = title.match(engineVolumePattern);
        if (engineMatch) {
          const volume = parseFloat(engineMatch[1]);
          if (volume >= 0.5 && volume <= 8.0) {
            engineVolume = volume;
          }
        }

        if (!brand || !model || !year || !mileage) {
          const params = Array.from(
            document.querySelectorAll(
              '[data-marker="item-view/item-params"] li',
            ),
          );
          params.forEach((param) => {
            const label =
              param
                .querySelector('[data-marker="item-view/item-params/label"]')
                ?.textContent?.toLowerCase() || '';
            const value =
              param
                .querySelector('[data-marker="item-view/item-params/value"]')
                ?.textContent?.trim() || '';

            if (
              (label.includes('марка') || label.includes('бренд')) &&
              !brand
            ) {
              brand = value;
            }
            if (label.includes('модель') && !model) {
              model = value;
            }
            if (label.includes('год') && !year) {
              year = parseInt(value) || 0;
            }
            if (label.includes('пробег') && !mileage) {
              mileage = parseInt(value.replace(/\D/g, '')) || 0;
            }
            if (
              (label.includes('коробка') ||
                label.includes('трансмиссия') ||
                label.includes('кпп')) &&
              !transmission
            ) {
              const transmissionValue = value.toLowerCase();
              if (transmissionValue.includes('автомат')) {
                transmission = 'AT';
              } else if (transmissionValue.includes('механ')) {
                transmission = 'MT';
              } else if (transmissionValue.includes('вариатор')) {
                transmission = 'CVT';
              } else if (transmissionValue.includes('робот')) {
                transmission = 'AMT';
              }
            }
            if (
              (label.includes('объем') ||
                label.includes('двигател') ||
                label.includes('мотор')) &&
              !engineVolume
            ) {
              const engineMatchParam = value.match(/(\d{1,2}\.?\d{0,2})/);
              if (engineMatchParam) {
                engineVolume = parseFloat(engineMatchParam[1]);
              }
            }
          });
        }

        const result: ExtractedData = {
          title,
          price: price,
          description,
          brand,
          model,
          year,
          mileage,
          location: {
            city,
            country,
          },
          transmission,
          engineVolume,
          images: [],
        };

        // Парсинг фотографий через модальное окно для получения лучшего качества
        const images: string[] = [];
        const seen = new Set<string>();

        // Находим первое фото и кликаем на него, чтобы открыть модальное окно
        const firstImage = document.querySelector(
          '[data-marker="image-frame/image"] img, [data-marker="image-viewer/image"] img, img[itemprop="image"], .gallery-img, img.desktop-1ky5g7j',
        );

        if (firstImage) {
          // Кликаем на первое фото
          (firstImage as HTMLElement).click();
          // Ждем открытия модального окна
          await new Promise((resolve) => setTimeout(resolve, 1500));

          // Ищем модальное окно с галереей
          const modal = document.querySelector(
            '[data-marker="image-viewer"] [data-marker="image-viewer/image"], [class*="image-viewer"] img, [class*="gallery"] img, [data-marker*="gallery"] img',
          );

          if (modal) {
            // Парсим фото из модального окна (там они в лучшем качестве)
            let attempts = 0;
            const maxAttempts = 50; // Максимум 50 фото

            while (attempts < maxAttempts) {
              // Ищем текущее изображение в модальном окне
              const currentImage = document.querySelector(
                '[data-marker="image-viewer/image"] img, [class*="image-viewer"] img[src*="avito"], [class*="gallery"] img[src*="avito"]',
              );

              if (currentImage && currentImage instanceof HTMLImageElement) {
                // Получаем URL изображения высокого качества
                // Пробуем разные атрибуты для получения лучшего качества
                let imageUrl =
                  currentImage.getAttribute('src') ||
                  currentImage.getAttribute('data-src') ||
                  currentImage.getAttribute('data-lazy-src') ||
                  currentImage.currentSrc;

                // Если URL содержит параметры размера, пытаемся получить оригинал
                if (imageUrl) {
                  // Убираем параметры размера для получения оригинала
                  imageUrl = imageUrl
                    .replace(/\/\d+x\d+\//, '/') // Убираем размеры типа /640x480/
                    .replace(/[?&]size=\d+x\d+/, '') // Убираем параметр size
                    .replace(/[?&]width=\d+/, '') // Убираем width
                    .replace(/[?&]height=\d+/, ''); // Убираем height

                  // Если URL не полный, делаем его полным
                  if (imageUrl.startsWith('//')) {
                    imageUrl = 'https:' + imageUrl;
                  } else if (imageUrl.startsWith('/')) {
                    imageUrl = 'https://www.avito.ru' + imageUrl;
                  }

                  if (imageUrl && !seen.has(imageUrl)) {
                    images.push(imageUrl);
                    seen.add(imageUrl);
                  }
                }
              }

              // Ищем кнопку "вперед" в модальном окне
              const nextButton = document.querySelector(
                '[data-marker="image-viewer/right-button"] button, [data-marker="image-viewer/right-button"], [class*="image-viewer"] [class*="next"], [class*="gallery"] [class*="next"] button, button[aria-label*="следующ"], button[aria-label*="next"]',
              );

              if (!nextButton) {
                // Пробуем альтернативные селекторы
                const altNextButton = document.querySelector(
                  '[data-marker*="next"], [class*="arrow-right"], [class*="next-button"]',
                );
                if (!altNextButton) break;
                (altNextButton as HTMLElement).click();
              } else {
                (nextButton as HTMLElement).click();
              }

              // Ждем загрузки следующего фото
              await new Promise((resolve) => setTimeout(resolve, 800));
              attempts++;
            }

            // Закрываем модальное окно (если есть кнопка закрытия)
            const closeButton = document.querySelector(
              '[data-marker="image-viewer/close-button"] button, [data-marker="image-viewer/close-button"], [class*="close"], button[aria-label*="закрыть"], button[aria-label*="close"]',
            );
            if (closeButton) {
              (closeButton as HTMLElement).click();
              await new Promise((resolve) => setTimeout(resolve, 500));
            }
          } else {
            // Если модальное окно не открылось, используем старый метод
            const currentSrc = document
              .querySelector('img.desktop-1ky5g7j')
              ?.getAttribute('src');
            if (currentSrc) {
              images.push(currentSrc);
              seen.add(currentSrc);
            }

            while (true) {
              const button = document.querySelector(
                '[data-marker="image-frame/right-button"] button',
              );
              if (!button) break;
              (button as HTMLElement).click();
              await new Promise((resolve) => setTimeout(resolve, 1000));
              const newSrc = document
                .querySelector('img.desktop-1ky5g7j')
                ?.getAttribute('src');
              if (!newSrc || seen.has(newSrc)) break;
              images.push(newSrc);
              seen.add(newSrc);
            }
          }
        } else {
          // Если не нашли первое фото, пробуем найти любые изображения
          const allImages = document.querySelectorAll(
            '[data-marker="image-frame/image"] img, [itemprop="image"]',
          );
          allImages.forEach((img) => {
            const src =
              (img as HTMLImageElement).src ||
              img.getAttribute('src') ||
              img.getAttribute('data-src');
            if (src && !seen.has(src)) {
              images.push(src);
              seen.add(src);
            }
          });
        }

        return result;
      });

      // Добавляем изображения, полученные из модального окна
      data.images = images;

      console.log('Extracted data:', data);

      // Используем findOneAndUpdate с upsert для обновления или создания записи
      // Это предотвращает ошибку дублирования ключа
      const car = await this.carModel.findOneAndUpdate(
        { url: normalizedUrl }, // Ищем по нормализованному URL
        {
          $set: {
            title: data.title,
            brand: data.brand,
            model: data.model,
            year: data.year,
            price: data.price,
            mileage: data.mileage,
            location: data.location,
            transmission: data.transmission,
            engineVolume: data.engineVolume,
            description: data.description,
            images: data.images,
            status: 'active', // При обновлении считаем объявление активным
            lastChecked: new Date(),
          },
          $setOnInsert: {
            // Эти поля устанавливаются только при создании новой записи
            url: normalizedUrl, // Сохраняем нормализованный URL без параметров отслеживания
            createdAt: new Date(),
          },
        },
        {
          upsert: true, // Создать запись, если не найдена
          new: true, // Вернуть обновленный документ
          runValidators: true, // Запустить валидацию
        },
      );

      return car;
    } catch (error) {
      throw new Error(`Failed to parse Avito ad: ${(error as Error).message}`);
    } finally {
      // Закрываем страницу перед закрытием браузера
      if (page) {
        try {
          await page.close();
        } catch (closeError) {
          console.warn('[AvitoParser] Error closing page:', closeError);
        }
      }
      if (browser) {
        try {
          // Закрываем все оставшиеся страницы перед закрытием браузера
          const pages = await browser.pages();
          for (const p of pages) {
            try {
              if (!p.isClosed()) {
                await p.close();
              }
            } catch (err) {
              // Игнорируем ошибки закрытия отдельных страниц
            }
          }
          await browser.close();
        } catch (closeError) {
          console.warn('[AvitoParser] Error closing browser:', closeError);
        }
      }
    }
  }
}
