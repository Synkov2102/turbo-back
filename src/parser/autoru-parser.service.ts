/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import PuppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Car, CarDocument } from '../schemas/car.schema';

PuppeteerExtra.use(StealthPlugin());

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91 Safari/537.36';

@Injectable()
export class AutoRuParserService {
  constructor(
    @InjectModel(Car.name) private carModel: Model<CarDocument>,
  ) {}

  async parseAndSave(url: string): Promise<Car> {
    // Валидация URL - проверяем что это Auto.ru
    if (!url.includes('auto.ru')) {
      throw new Error('URL должен быть с домена auto.ru');
    }

    let browser: any;

    try {
      browser = await PuppeteerExtra.launch({
        headless: false, // чтоб можно было руками решать капчу
        defaultViewport: null,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      // Создаем страницу в инкогнито контексте
      // В Puppeteer createBrowserContext() автоматически создает инкогнито контекст
      const incognitoContext = await browser.createBrowserContext();
      const page = await incognitoContext.newPage();
      await page.setUserAgent(USER_AGENT);

      // немного человечных заголовков
      await page.setExtraHTTPHeaders({
        'accept-language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      });

      console.log('Opening page:', url);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 0 });

      // ждём, пока прогрузится основной JSON с атрибутами объявления
      await page.waitForFunction(
        () => !!document.querySelector('#sale-data-attributes'),
        { timeout: 10 * 60 * 1000 },
      );

      // ---------- sale-data-attributes (бренд, модель, год, цена, пробег, коробка) ----------
      const saleData = await page.evaluate(() => {
        const el = document.querySelector('#sale-data-attributes');
        if (!el) return null;

        const raw = el.getAttribute('data-bem');
        if (!raw) return null;

        try {
          const parsed = JSON.parse(raw);
          return parsed['sale-data-attributes'] || null;
        } catch {
          return null;
        }
      });

      console.log('Sale data extracted:', saleData);

      // ---------- заголовок ----------
      const title = await page.evaluate(() => {
        const h1 = document.querySelector('h1');
        return h1?.textContent?.trim() || document.title || '';
      });

      // ---------- описание ----------
      const description = await page.evaluate(() => {
        // основной контейнер описания
        const node =
          document.querySelector<HTMLElement>('.CardDescriptionHTML') ||
          document.querySelector<HTMLElement>('.CardDescription__textInner') ||
          document.querySelector<HTMLElement>(
            '[data-ftid="component_description"]',
          );

        return node?.textContent?.trim() || '';
      });

      // ---------- город и страна ----------
      const { city, country } = await page.evaluate(() => {
        const regionSpan =
          document.querySelector<HTMLElement>(
            '.CardSellerNamePlace2__place .MetroListPlace__regionName',
          ) ||
          document.querySelector<HTMLElement>('.MetroListPlace__regionName');

        const text = regionSpan?.textContent?.trim() || '';
        if (!text) return { city: 'Unknown', country: 'Россия' };

        // на всякий случай обрежем всё после запятой
        const cityValue = text.split(',')[0].trim() || 'Unknown';
        // По умолчанию Россия для Auto.ru
        return { city: cityValue, country: 'Россия' };
      });

      // ---------- характеристики: двигатель (объём) + коробка ----------
      const { engineVolume, transmissionFromDom } = await page.evaluate(() => {
        const result = {
          engineVolume: 0,
          transmissionFromDom: '',
        };

        const rows = Array.from(
          document.querySelectorAll<HTMLLIElement>(
            '.CardInfoSummary__list-jpQIS .CardInfoSummaryComplexRow-CngDv',
          ),
        );

        for (const row of rows) {
          const titleEl = row.querySelector<HTMLElement>(
            '.CardInfoSummaryComplexRow__cellTitle-S_R1k',
          );
          const valueEl = row.querySelector<HTMLElement>(
            '.CardInfoSummaryComplexRow__cellValue-Hka8p',
          );

          const label = titleEl?.textContent?.trim() || '';
          const valueText = valueEl?.textContent?.trim() || '';

          if (!label || !valueText) continue;

          // Двигатель: "6.3 л, 250 л.с. бензин"
          if (label === 'Двигатель') {
            const m = valueText.replace(',', '.').match(/(\d+(?:\.\d+)?)\s*л/);
            if (m) {
              const vol = parseFloat(m[1]);
              if (!Number.isNaN(vol)) {
                result.engineVolume = vol;
              }
            }
          }

          // Коробка: "автоматическая", "механическая", "вариатор" и т.п.
          if (label === 'Коробка') {
            const low = valueText.toLowerCase();

            if (low.includes('автомат')) {
              result.transmissionFromDom = 'AT';
            } else if (low.includes('механ')) {
              result.transmissionFromDom = 'MT';
            } else if (low.includes('вариатор')) {
              result.transmissionFromDom = 'CVT';
            } else if (low.includes('робот')) {
              result.transmissionFromDom = 'AMT';
            } else {
              result.transmissionFromDom = valueText;
            }
          }
        }

        return result;
      });

      // --- Фото автомобиля (отфильтрованные, только большие) ---
      const images = await page.evaluate(() => {
        const urls = new Set<string>();

        const galleryImages = Array.from(
          document.querySelectorAll<HTMLImageElement>(
            '.ImageGalleryDesktop img',
          ),
        );

        for (const img of galleryImages) {
          let src = img.getAttribute('src') || img.getAttribute('data-src');
          if (!src) continue;

          src = src.trim();
          if (src.startsWith('//')) src = 'https:' + src;

          const lower = src.toLowerCase();

          // 1. Убираем фото пользователя
          if (lower.includes('get-autoru-users')) continue;

          // 2. Убираем маленькие версии
          if (lower.includes('small')) continue;

          // 3. Убираем статические auto.ru картинки
          if (lower.includes('autoru.static-storage.net')) continue;

          // 4. Нормализуем разрешение → 1200x900n
          src = src.replace(/\/\d+x\d+n?$/, '/1200x900n');

          urls.add(src);
        }

        return Array.from(urls);
      });

      // ---------- текст цены для определения валюты ----------
      const priceText = await page.evaluate(() => {
        const priceElement =
          document.querySelector('.CardPrice__price') ||
          document.querySelector('[data-ftid="component_price"]') ||
          document.querySelector('.price-value');
        return priceElement?.textContent?.trim() || '';
      });

      // ---------- подготавливаем данные ----------

      let brand = saleData?.markName || '';
      let model = saleData?.modelName || '';
      const year = saleData?.year ? Number(saleData.year) : 0;
      const priceValue = saleData?.price ? Number(saleData.price) : 0;
      const mileage = saleData?.['km-age'] ? Number(saleData['km-age']) : 0;

      // Определяем валюту (Auto.ru обычно в рублях, но проверим)
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
        // По умолчанию рубли (Auto.ru обычно в рублях)
        price.RUB = priceValue;
      }

      // Коробка: приоритет DOM, потом saleData.transmission
      let transmission = transmissionFromDom || '';
      if (!transmission && saleData?.transmission) {
        const tr = String(saleData.transmission).toLowerCase();
        if (tr.includes('at') || tr.includes('автомат')) transmission = 'AT';
        else if (tr.includes('mt') || tr.includes('механ')) transmission = 'MT';
        else if (tr.includes('cvt') || tr.includes('вариатор'))
          transmission = 'CVT';
        else if (tr.includes('amt') || tr.includes('робот'))
          transmission = 'AMT';
        else transmission = saleData.transmission;
      }

      const finalTitle =
        title ||
        [brand, model, year].filter(Boolean).join(' ').trim() ||
        'Auto.ru объявление';

      const carData = {
        title: finalTitle,
        brand,
        model,
        year,
        price: price,
        mileage,
        location: {
          city,
          country,
        },
        transmission,
        engineVolume: engineVolume || 0,
        description,
        images,
      };

      console.log('FINAL CAR DATA:', carData);

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
      console.error('Auto.ru parse error:', e);
      throw new Error(`Failed to parse Auto.ru ad: ${(e as Error).message}`);
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }
}
