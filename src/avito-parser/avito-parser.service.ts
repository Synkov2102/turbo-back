/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import PuppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Car, CarDocument } from '../schemas/car.schema';

// Use stealth plugin
PuppeteerExtra.use(StealthPlugin());

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

interface ExtractedData {
  title: string;
  price: number;
  description: string;
  brand: string;
  model: string;
  year: number;
  mileage: number;
  city: string;
  transmission: string;
  engineVolume: number;
  images: string[];
}

@Injectable()
export class AvitoParserService {
  constructor(
    @InjectModel(Car.name) private carModel: Model<CarDocument>,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async parseAndSave(url: string): Promise<Car> {
    let browser: any;

    try {
      console.log('Launching browser...');
      browser = await PuppeteerExtra.launch({
        headless: false, // пользователь сможет сам решить капчу
        defaultViewport: null,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--start-maximized',
        ],
      });

      const page: any = await browser.newPage();

      // Заголовки и UA
      await page.setExtraHTTPHeaders({
        'accept-language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      });
      await page.setUserAgent(USER_AGENT);

      // Доп. настройка среды до загрузки страницы
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => false,
        });

        (window as any).chrome = { runtime: {} };

        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5],
        });

        Object.defineProperty(navigator, 'languages', {
          get: () => ['ru-RU', 'ru', 'en-US', 'en'],
        });

        const originalQuery = window.Notification?.requestPermission;
        if (originalQuery) {
          (window.Notification as any).requestPermission = (...args: any[]) =>
            originalQuery.apply(window.Notification, args);
        }
      });

      page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));

      console.log('Navigating to URL:', url);
      await page.goto(url, { waitUntil: 'networkidle2' });
      console.log('Page loaded, current URL:', page.url());

      // Немного подождать динамику
      await new Promise((resolve) => setTimeout(resolve, 2000));

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

      const data = (await page.evaluate(async () => {
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
        const price = parseInt(priceText.replace(/\D/g, '')) || 0;

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
          price,
          description,
          brand,
          model,
          year,
          mileage,
          city,
          transmission,
          engineVolume,
          images: [],
        };

        const images: string[] = [];
        const seen = new Set<string>();

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

        result.images = images;
        return result;
      })) as ExtractedData;

      console.log('Extracted data:', data);

      const car = new this.carModel({
        title: data.title,
        brand: data.brand,
        model: data.model,
        year: data.year,
        price: data.price,
        mileage: data.mileage,
        city: data.city,
        transmission: data.transmission,
        engineVolume: data.engineVolume,
        description: data.description,
        url,
        images: data.images,
      });

      return await car.save();
    } catch (error) {
      throw new Error(`Failed to parse Avito ad: ${(error as Error).message}`);
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }
}
