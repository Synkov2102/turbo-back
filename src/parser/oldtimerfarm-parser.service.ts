import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { Browser, Page } from 'puppeteer';
import { Car, CarDocument } from '../schemas/car.schema';
import { BaseParserService } from './utils/base-parser.service';
import { DEFAULT_HEADLESS } from './utils/browser-helper';
import { ParallelParserHelper } from './utils/parallel-parser.helper';
import { BrowserPool } from './utils/browser-pool.service';

interface CarLink {
  url: string;
  title: string;
}

interface ParseAllResult {
  total: number;
  parsed: number;
  skipped: number;
  errors: number;
  cars: Car[];
  errorsList: Array<{ url: string; error: string }>;
}

@Injectable()
export class OldtimerfarmParserService extends BaseParserService {
  constructor(@InjectModel(Car.name) private carModel: Model<CarDocument>) {
    super(OldtimerfarmParserService.name);
  }

  /**
   * Парсит и сохраняет автомобиль (версия с переиспользованием браузера)
   */
  async parseAndSaveWithPool(
    url: string,
    browserPool: BrowserPool,
    skipMotorcycles: boolean = false,
  ): Promise<Car | null> {
    // Валидация URL - проверяем что это oldtimerfarm.be
    if (!url.includes('oldtimerfarm.be')) {
      throw new Error('URL должен быть с домена oldtimerfarm.be');
    }

    let page: Page | undefined;

    try {
      // Получаем страницу из пула браузеров
      page = await browserPool.getPage(true, {
        'accept-language': 'en-US,en;q=0.9,nl;q=0.8,fr;q=0.7,de;q=0.6',
      });

      this.logger.log(`[OldtimerfarmParser] Opening page: ${url}`);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 0 });

      // Ждем загрузки основных элементов (уменьшен таймаут с 10 минут до 30 секунд)
      await page.waitForSelector('h1', {
        timeout: 30000,
      });
      await page.waitForSelector('#specifications', {
        timeout: 30000,
      });

      // Если нужно пропускать мотоциклы, проверяем тип транспорта
      if (skipMotorcycles) {
        const vehicleType = await this.getVehicleTypeFromPage(page);
        if (vehicleType === 'moto') {
          this.logger.log(`[OldtimerfarmParser] Skipping motorcycle: ${url}`);
          return null;
        }
        if (vehicleType === null) {
          this.logger.warn(
            `[OldtimerfarmParser] Could not determine vehicle type for: ${url}, skipping`,
          );
          return null;
        }
      }

      // ---------- Заголовок ----------
      const title = await page.evaluate(() => {
        const h1 = document.querySelector('h1');
        return h1?.textContent?.trim() || document.title || '';
      });

      this.logger.log(`[OldtimerfarmParser] Title: ${title}`);

      // ---------- Спецификации ----------
      const specifications = await page.evaluate(() => {
        const specDiv = document.querySelector('#specifications');
        if (!specDiv) return null;

        const specs: Record<string, string> = {};
        const divs = specDiv.querySelectorAll('div');

        divs.forEach((div) => {
          const strong = div.querySelector('strong');
          const span = div.querySelector('span');
          if (strong && span) {
            const key = strong.textContent?.trim() || '';
            const value = span.textContent?.trim() || '';
            if (key && value) {
              specs[key] = value;
            }
          }
        });

        return specs;
      });

      this.logger.debug(
        `[OldtimerfarmParser] Specifications: ${JSON.stringify(specifications)}`,
      );

      // ---------- Цена ----------
      const priceText = await page.evaluate(() => {
        const priceElement =
          document.querySelector('.price') ||
          document.querySelector('#specifications [strong="Price"] + span');
        return priceElement?.textContent?.trim() || '';
      });

      const priceValue = parseInt(priceText.replace(/[^\d]/g, '')) || 0;
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
        // По умолчанию евро (Oldtimerfarm обычно в евро)
        price.EUR = priceValue;
      }

      // ---------- Извлечение данных из спецификаций ----------
      let make = (specifications?.Make as string) || '';
      let model = (specifications?.Model as string) || '';
      // Убираем год из модели (например, '71 или 71)
      model = model.replace(/\s*['']?\d{2}\s*$/, '').trim();
      const yearText = (specifications?.['Construction year'] as string) || '';
      const year = yearText ? parseInt(yearText, 10) || 0 : 0;

      // Если бренда нет в спецификациях: из заголовка — первое слово после года = бренд, остальное = модель
      if (!make && title) {
        const yearMatchTitle = title.match(/\b(19|20)\d{2}\b/);
        let textAfterYear = title;
        if (yearMatchTitle) {
          textAfterYear = title.replace(yearMatchTitle[0], '').trim();
        }
        const parts = textAfterYear.split(/\s+/).filter((p) => p);
        if (parts.length >= 1) {
          make = parts[0];
          if (parts.length >= 2 && !model) {
            model = parts
              .slice(1)
              .join(' ')
              .replace(/\s*['']?\d{2}\s*$/, '')
              .trim();
          }
        }
      }
      const mileageText = (specifications?.KM as string) || '';
      const mileage = mileageText
        ? parseInt(mileageText.replace(/[^\d]/g, ''), 10) || 0
        : 0;
      const engineVolumeText =
        (specifications?.['Cilinder displacement'] as string) || '';
      const engineVolume = engineVolumeText
        ? parseFloat(engineVolumeText.replace(/[^\d.]/g, '')) / 1000 || 0
        : 0; // Конвертируем из куб.см в литры

      // ---------- Трансмиссия ----------
      const transmissionText = (specifications?.Gears as string) || '';
      let transmission = '';
      if (transmissionText) {
        const transLower = transmissionText.toLowerCase();
        if (transLower.includes('manual') || transLower.includes('механ')) {
          transmission = 'MT';
        } else if (
          transLower.includes('automatic') ||
          transLower.includes('автомат')
        ) {
          transmission = 'AT';
        } else if (
          transLower.includes('cvt') ||
          transLower.includes('вариатор')
        ) {
          transmission = 'CVT';
        } else if (
          transLower.includes('robot') ||
          transLower.includes('робот')
        ) {
          transmission = 'AMT';
        }
      }

      // ---------- Город и страна ----------
      const { city, country } = await page.evaluate(() => {
        // Пробуем найти адрес в футере или других местах
        const footer = document.querySelector('#footerblocks');
        let cityValue = 'Unknown';
        if (footer) {
          const addressText = footer.textContent || '';
          // Ищем город в адресе (обычно после почтового индекса)
          const cityMatch = addressText.match(/\d{4}\s+([A-Za-z\s]+)/);
          if (cityMatch) {
            cityValue = cityMatch[1].trim();
          }
        }
        // Oldtimerfarm - это бельгийский сайт
        return { city: cityValue, country: 'Бельгия' };
      });

      // ---------- Описание ----------
      const description = await page.evaluate(() => {
        const descDiv = document.querySelector('#description');
        if (!descDiv) return '';

        // Убираем кнопку "Read more" если есть
        const readMore = descDiv.querySelector('.readmore');
        if (readMore) {
          readMore.remove();
        }

        return descDiv.textContent?.trim() || '';
      });

      // ---------- Фото автомобиля ----------
      const images = await page.evaluate(() => {
        const urls = new Set<string>();
        const gallery = document.querySelector('#gallery');

        if (gallery) {
          // Ищем все ссылки на изображения
          const links = gallery.querySelectorAll<HTMLAnchorElement>(
            'a[data-fancybox="gallery"]',
          );

          links.forEach((link) => {
            const href = link.getAttribute('href');
            if (href) {
              // Фильтруем YouTube ссылки и другие видео
              const hrefLower = href.toLowerCase();
              if (
                hrefLower.includes('youtube.com') ||
                hrefLower.includes('youtu.be') ||
                hrefLower.includes('vimeo.com') ||
                hrefLower.includes('.mp4') ||
                hrefLower.includes('.mov') ||
                hrefLower.includes('.avi')
              ) {
                return; // Пропускаем видео ссылки
              }

              // Используем полный URL изображения
              const fullUrl = href.startsWith('http')
                ? href
                : href.startsWith('//')
                  ? 'https:' + href
                  : 'https://www.oldtimerfarm.be' + href;

              // Проверяем, что это действительно изображение
              const imageExtensions = [
                '.jpg',
                '.jpeg',
                '.png',
                '.gif',
                '.webp',
              ];
              const isImage = imageExtensions.some((ext) =>
                fullUrl.toLowerCase().includes(ext),
              );

              if (isImage) {
                urls.add(fullUrl);
              }
            }
          });
        }

        return Array.from(urls);
      });

      this.logger.log(`[OldtimerfarmParser] Images found: ${images.length}`);

      // ---------- Подготавливаем данные ----------
      // Убираем год из заголовка, если он там есть (например, '71)
      const cleanTitle = title.replace(/\s*['']?\d{2}\s*$/, '').trim();
      const finalTitle =
        cleanTitle ||
        [make, model, year].filter(Boolean).join(' ').trim() ||
        'Oldtimerfarm объявление';

      const carData = {
        title: finalTitle,
        brand: make,
        model: model,
        year: year,
        price: price,
        mileage: mileage,
        location: {
          city,
          country,
        },
        transmission: transmission,
        engineVolume: engineVolume || 0,
        description: description,
        images: images,
      };

      this.logger.debug(
        `[OldtimerfarmParser] FINAL CAR DATA: ${JSON.stringify(carData)}`,
      );

      // Проверяем, существует ли уже автомобиль с таким URL
      const existingCar = await this.carModel.findOne({ url }).exec();
      if (existingCar) {
        // Обновляем существующую запись
        Object.assign(existingCar, {
          ...carData,
          status: 'active', // При обновлении считаем объявление активным
          lastChecked: new Date(),
        });
        return await existingCar.save();
      }

      // Создаем новую запись
      const car = new this.carModel({
        ...carData,
        url,
        status: 'active',
        lastChecked: new Date(),
      });

      return await car.save();
    } catch (e) {
      this.logger.error(
        `[OldtimerfarmParser] Parse error: ${(e as Error).message}`,
        (e as Error).stack,
      );
      throw new Error(
        `Failed to parse Oldtimerfarm ad: ${(e as Error).message}`,
      );
    } finally {
      if (page) {
        await browserPool.releasePage(page);
      }
    }
  }

  /**
   * Парсит и сохраняет автомобиль (оригинальная версия с созданием браузера)
   */
  async parseAndSave(
    url: string,
    skipMotorcycles: boolean = false,
  ): Promise<Car | null> {
    // Валидация URL - проверяем что это oldtimerfarm.be
    if (!url.includes('oldtimerfarm.be')) {
      throw new Error('URL должен быть с домена oldtimerfarm.be');
    }

    let browser: Browser | undefined;

    try {
      // В Docker всегда используется headless режим (автоматически в getBaseLaunchOptions)
      // Локально можно использовать false для решения капчи вручную
      const useHeadless =
        process.env.NODE_ENV === 'production' ? DEFAULT_HEADLESS : false;
      const { browser: browserInstance, page } = await this.setupBrowserAndPage(
        useHeadless,
        [],
        true,
        {
          'accept-language': 'en-US,en;q=0.9,nl;q=0.8,fr;q=0.7,de;q=0.6',
        },
      );
      browser = browserInstance;

      this.logger.log(`[OldtimerfarmParser] Opening page: ${url}`);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 0 });

      // Ждем загрузки основных элементов
      await page.waitForSelector('h1', {
        timeout: 30000,
      });
      await page.waitForSelector('#specifications', {
        timeout: 30000,
      });

      // Если нужно пропускать мотоциклы, проверяем тип транспорта
      if (skipMotorcycles) {
        const vehicleType = await this.getVehicleTypeFromPage(page);
        if (vehicleType === 'moto') {
          this.logger.log(`[OldtimerfarmParser] Skipping motorcycle: ${url}`);
          return null;
        }
        if (vehicleType === null) {
          this.logger.warn(
            `[OldtimerfarmParser] Could not determine vehicle type for: ${url}, skipping`,
          );
          return null;
        }
      }

      // Закрываем существующую страницу и используем пул для переиспользования кода
      const currentContext = page.browserContext();
      await page.close();

      const browserPool = new BrowserPool('OldtimerfarmParser');
      // Устанавливаем существующий браузер и контекст в пул
      (browserPool as any).browser = browser;
      (browserPool as any).context = currentContext;
      (browserPool as any).isInitialized = true;

      try {
        // Используем пул для создания новой страницы и парсинга
        // parseAndSaveWithPool создаст новую страницу и загрузит URL заново
        return await this.parseAndSaveWithPool(
          url,
          browserPool,
          skipMotorcycles,
        );
      } finally {
        // Очищаем ссылки на браузер и контекст (браузер будет закрыт в finally блоке выше)
        (browserPool as any).browser = null;
        (browserPool as any).context = null;
        (browserPool as any).isInitialized = false;
      }
    } catch (e) {
      this.logger.error(
        `[OldtimerfarmParser] Parse error: ${(e as Error).message}`,
        (e as Error).stack,
      );
      throw new Error(
        `Failed to parse Oldtimerfarm ad: ${(e as Error).message}`,
      );
    } finally {
      if (browser) {
        await this.closeBrowser(browser);
      }
    }
  }

  /**
   * Получает список ссылок на объявления со страницы списка
   */
  async getCarLinksFromListPage(listUrl: string): Promise<CarLink[]> {
    let browser: Browser | undefined;

    try {
      // В Docker всегда используется headless режим (автоматически в getBaseLaunchOptions)
      // Локально можно использовать false для решения капчи вручную
      const useHeadless =
        process.env.NODE_ENV === 'production' ? DEFAULT_HEADLESS : false;
      const { browser: browserInstance, page } = await this.setupBrowserAndPage(
        useHeadless,
        ['--no-sandbox', '--disable-setuid-sandbox'],
        true,
      );
      browser = browserInstance;

      // Устанавливаем дополнительные заголовки для Oldtimerfarm
      await page.setExtraHTTPHeaders({
        'accept-language': 'en-US,en;q=0.9,nl;q=0.8,fr;q=0.7,de;q=0.6',
      });

      this.logger.log(`[OldtimerfarmParser] Opening list page: ${listUrl}`);
      await page.goto(listUrl, { waitUntil: 'networkidle2', timeout: 0 });

      // Ждем загрузки списка объявлений
      // Ссылки имеют формат: /en/collection-cars-for-sale/{id}/{slug}.php
      await page.waitForSelector('a[href*="/collection-cars-for-sale/"]', {
        timeout: 30000,
      });

      // Извлекаем все ссылки на объявления
      const carLinks = await page.evaluate(() => {
        const links: CarLink[] = [];
        // Ищем ссылки вида /en/collection-cars-for-sale/{id}/{slug}.php
        const linkElements = document.querySelectorAll<HTMLAnchorElement>(
          'a[href*="/collection-cars-for-sale/"]',
        );

        linkElements.forEach((link) => {
          const href = link.getAttribute('href');
          const title = link.textContent?.trim() || '';

          if (href) {
            // Фильтруем только ссылки на отдельные объявления
            // Формат: /en/collection-cars-for-sale/{id}/{slug}.php
            // Исключаем ссылки на саму страницу списка: /en/collection-cars-for-sale.php
            const isCarDetailPage =
              href.includes('/collection-cars-for-sale/') &&
              !href.endsWith('collection-cars-for-sale.php') &&
              !href.includes('collection-cars-for-sale.php?') &&
              /\/collection-cars-for-sale\/\d+\//.test(href);

            if (!isCarDetailPage) {
              return; // Пропускаем ссылки, которые не являются объявлениями
            }

            // Преобразуем относительный URL в абсолютный
            const fullUrl = href.startsWith('http')
              ? href
              : href.startsWith('//')
                ? 'https:' + href
                : 'https://www.oldtimerfarm.be' + href;

            // Проверяем, что это не дубликат
            if (!links.some((l) => l.url === fullUrl)) {
              links.push({
                url: fullUrl,
                title,
              });
            }
          }
        });

        return links;
      });

      this.logger.log(
        `[OldtimerfarmParser] Found ${carLinks.length} car links on list page`,
      );

      return carLinks;
    } catch (e) {
      this.logger.error(
        `[OldtimerfarmParser] Error getting car links: ${(e as Error).message}`,
      );
      throw new Error(
        `Failed to get car links from list page: ${(e as Error).message}`,
      );
    } finally {
      await this.closeBrowser(browser);
    }
  }

  /**
   * Определяет тип транспорта на уже открытой странице
   * @param page Открытая страница Puppeteer
   * @returns 'car' для автомобилей, 'moto' для мотоциклов, null если не удалось определить
   */
  private async getVehicleTypeFromPage(
    page: Page,
  ): Promise<'car' | 'moto' | null> {
    // Ищем информацию о типе транспорта
    // Проверяем спецификации и другие элементы страницы
    const vehicleType = await page.evaluate(() => {
      // Проверяем наличие спецификаций
      const specDiv = document.querySelector('#specifications');
      if (!specDiv) return null;

      // Ищем поле Type или Category
      const specs: Record<string, string> = {};
      const divs = specDiv.querySelectorAll('div');

      divs.forEach((div) => {
        const strong = div.querySelector('strong');
        const span = div.querySelector('span');
        if (strong && span) {
          const key = strong.textContent?.trim() || '';
          const value = span.textContent?.trim() || '';
          if (key && value) {
            specs[key.toLowerCase()] = value.toLowerCase();
          }
        }
      });

      // Проверяем поле Type
      if (specs.type) {
        if (specs.type.includes('moto')) {
          return 'moto';
        }
        if (
          specs.type.includes('car') ||
          specs.type.includes('auto') ||
          specs.type.includes('vehicle')
        ) {
          return 'car';
        }
      }

      // Проверяем заголовок и описание на наличие ключевых слов
      const h1 = document.querySelector('h1')?.textContent?.toLowerCase() || '';
      const bodyText = document.body?.textContent?.toLowerCase() || '';

      // Ключевые слова для мотоциклов
      const motoKeywords = [
        'motorcycle',
        'moto',
        'bike',
        'scooter',
        'harley',
        'ducati',
        'yamaha',
        'honda',
        'norton',
        'triumph',
        'moto guzzi',
      ];

      // Ключевые слова для автомобилей
      const carKeywords = [
        'car',
        'automobile',
        'vehicle',
        'saloon',
        'coupe',
        'convertible',
        'roadster',
      ];

      const hasMotoKeywords = motoKeywords.some(
        (keyword) => h1.includes(keyword) || bodyText.includes(keyword),
      );
      const hasCarKeywords = carKeywords.some(
        (keyword) => h1.includes(keyword) || bodyText.includes(keyword),
      );

      if (hasMotoKeywords && !hasCarKeywords) {
        return 'moto';
      }
      if (hasCarKeywords) {
        return 'car';
      }

      return null;
    });

    return vehicleType;
  }

  /**
   * Определяет тип транспорта (автомобиль или мотоцикл)
   * @param url URL объявления
   * @returns 'car' для автомобилей, 'moto' для мотоциклов, null если не удалось определить
   * @deprecated Используйте parseAndSave с skipMotorcycles=true вместо этого метода
   */
  async getVehicleType(url: string): Promise<'car' | 'moto' | null> {
    let browser: Browser | undefined;

    try {
      // В Docker всегда используется headless режим (автоматически в getBaseLaunchOptions)
      // Локально можно использовать false для решения капчи вручную
      const useHeadless =
        process.env.NODE_ENV === 'production' ? DEFAULT_HEADLESS : false;
      const { browser: browserInstance, page } = await this.setupBrowserAndPage(
        useHeadless,
        ['--no-sandbox', '--disable-setuid-sandbox'],
        true,
      );
      browser = browserInstance;

      // Устанавливаем дополнительные заголовки для Oldtimerfarm
      await page.setExtraHTTPHeaders({
        'accept-language': 'en-US,en;q=0.9,nl;q=0.8,fr;q=0.7,de;q=0.6',
      });

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 0 });

      return await this.getVehicleTypeFromPage(page);
    } catch (e) {
      this.logger.error(
        `[OldtimerfarmParser] Error determining vehicle type: ${(e as Error).message}`,
      );
      return null;
    } finally {
      await this.closeBrowser(browser);
    }
  }

  /**
   * Парсит все автомобили со страницы списка
   * Пропускает мотоциклы (type = moto)
   */
  async parseAllCarsFromList(
    listUrl: string = 'https://www.oldtimerfarm.be/en/collection-cars-for-sale.php?categorie=collectiewagen',
  ): Promise<ParseAllResult> {
    this.logger.log(
      `[OldtimerfarmParser] Starting global parsing from: ${listUrl}`,
    );

    const result: ParseAllResult = {
      total: 0,
      parsed: 0,
      skipped: 0,
      errors: 0,
      cars: [],
      errorsList: [],
    };

    try {
      // Получаем список всех ссылок на объявления
      const carLinks = await this.getCarLinksFromListPage(listUrl);
      result.total = carLinks.length;

      this.logger.log(
        `[OldtimerfarmParser] Found ${carLinks.length} total listings`,
      );

      // Инициализируем пул браузеров для переиспользования
      const browserPool = new BrowserPool('OldtimerfarmParser');
      const useHeadless =
        process.env.NODE_ENV === 'production' ? DEFAULT_HEADLESS : false;
      await browserPool.initialize(useHeadless, []);

      let parseResults: Array<{
        item: { url: string; title: string };
        result: Car | null;
        error: string | null;
      }> = [];

      try {
        // Парсим объявления параллельно (по 5 одновременно с переиспользованием браузера)
        parseResults = await ParallelParserHelper.processInParallelWithDelay(
          carLinks,
          async (link, index) => {
            this.logger.log(
              `[OldtimerfarmParser] Parsing ${index + 1}/${carLinks.length}: ${link.url}`,
            );
            return await this.parseAndSaveWithPool(link.url, browserPool, true); // skipMotorcycles = true
          },
          5, // Увеличено до 5 благодаря переиспользованию браузера
          500, // Уменьшена задержка до 500мс
          this.logger,
        );
      } finally {
        // Очищаем пул браузеров
        await browserPool.cleanup();
      }

      // Обрабатываем результаты
      for (const parseResult of parseResults) {
        if (parseResult.error) {
          result.errors++;
          result.errorsList.push({
            url: parseResult.item.url,
            error: parseResult.error,
          });
        } else if (parseResult.result === null) {
          // Это мотоцикл или не удалось определить тип
          result.skipped++;
        } else {
          result.cars.push(parseResult.result);
          result.parsed++;
        }
      }

      this.logger.log(
        `[OldtimerfarmParser] Global parsing completed: ${result.parsed} parsed, ${result.skipped} skipped, ${result.errors} errors`,
      );

      return result;
    } catch (error) {
      this.logger.error(
        `[OldtimerfarmParser] Fatal error in global parsing: ${(error as Error).message}`,
      );
      throw error;
    }
  }
}
