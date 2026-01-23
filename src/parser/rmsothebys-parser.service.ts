import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import PuppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Car, CarDocument } from '../schemas/car.schema';

PuppeteerExtra.use(StealthPlugin());

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91 Safari/537.36';

// Список брендов для распознавания (отсортированы по длине для правильного совпадения)
const POTENTIAL_BRANDS = [
  'Mercedes-Benz',
  'Rolls-Royce',
  'Alfa Romeo',
  'Aston Martin',
  'Talbot-Lago',
  'Land Rover',
  'Range Rover',
  'Austin-Healey',
  'Pierce-Arrow',
  'Lamborghini',
  'McLaren',
  'Chevrolet',
  'Ferrari',
  'Porsche',
  'Mercedes',
  'Bentley',
  'Maserati',
  'Bugatti',
  'Jaguar',
  'Cadillac',
  'Renault',
  'Lincoln',
  'Packard',
  'Duesenberg',
  'Shelby',
  'Studebaker',
  'Lotus',
  'Morgan',
  'Triumph',
  'Ford',
  'BMW',
  'Audi',
  'Volkswagen',
  'Volvo',
  'Mini',
  'MG',
  'Cord',
  'Tucker',
  'Koenigsegg',
  'Pagani',
  'Saleen',
  'Caterham',
  'TVR',
  'Lancia',
  'Fiat',
  'Abarth',
  'Alpine',
  'De Tomaso',
  'Iso',
  'Bizzarrini',
  'AC',
  'Jensen',
  'Healey',
  'Ginetta',
  'Marcos',
  'Gordon-Keeble',
  'Reliant',
  'Lister',
  'Noble',
  'Westfield',
  'Graham',
  'Hudson',
  'Nash',
  'Kaiser',
  'Willys',
  'Crosley',
  'DeSoto',
  'Plymouth',
  'Dodge',
  'Chrysler',
  'Buick',
  'Oldsmobile',
  'Pontiac',
  'GMC',
  'AMC',
  'Datsun',
  'Nissan',
  'Toyota',
  'Honda',
  'Mazda',
  'Subaru',
  'Mitsubishi',
  'Lexus',
  'Infiniti',
  'Acura',
  'Genesis',
  'Hyundai',
  'Kia',
] as const;

interface ParseAllLinksResult {
  total: number;
  links: string[];
  errors: number;
  errorsList: Array<{ url: string; error: string }>;
}

@Injectable()
export class RmsothebysParserService {
  private readonly logger = new Logger(RmsothebysParserService.name);

  constructor(@InjectModel(Car.name) private carModel: Model<CarDocument>) { }

  /**
   * Парсит все ссылки со страницы поиска RM Sotheby's
   */
  async parseAllLinks(url?: string): Promise<ParseAllLinksResult> {
    const defaultUrl =
      'https://rmsothebys.com/search#?SortBy=Availability&CategoryTag=All%20Motor%20Vehicles&page=1&pageSize=40&OfferStatus=On%20Offer';

    const searchUrl = url || defaultUrl;
    this.logger.log(`Парсинг всех ссылок с URL: ${searchUrl}`);

    const result: ParseAllLinksResult = {
      total: 0,
      links: [],
      errors: 0,
      errorsList: [],
    };

    let browser: any;

    try {
      browser = await PuppeteerExtra.launch({
        headless: false,
        defaultViewport: null,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      const incognitoContext = await browser.createBrowserContext();
      const page = await incognitoContext.newPage();
      await page.setUserAgent(USER_AGENT);

      await page.setExtraHTTPHeaders({
        'accept-language': 'en-US,en;q=0.9',
      });

      this.logger.log('Открываем страницу поиска...');
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 0 });

      // Ждем загрузки результатов
      await page.waitForSelector('a[href*="/auctions/"], a[href*="/ps00/"]', {
        timeout: 30000,
      });

      const allLinks = new Set<string>();
      let currentPage = 1;
      let hasMorePages = true;

      // Итерируемся по всем страницам
      while (hasMorePages) {
        this.logger.log(`Парсинг страницы ${currentPage}...`);

        // Ждем загрузки результатов на текущей странице
        await page.waitForSelector('a[href*="/auctions/"], a[href*="/ps00/"]', {
          timeout: 30000,
        });

        // Небольшая задержка для полной загрузки динамического контента
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Извлекаем все ссылки на страницы автомобилей с текущей страницы
        const pageLinks = (await page.evaluate(() => {
          const carLinks = new Set<string>();
          const anchors = document.querySelectorAll<HTMLAnchorElement>(
            'a[href*="/auctions/"], a[href*="/ps00/"]',
          );

          anchors.forEach((anchor) => {
            const href = anchor.getAttribute('href');
            if (href) {
              let fullUrl = href;
              if (href.startsWith('/')) {
                fullUrl = 'https://rmsothebys.com' + href;
              }
              // Фильтруем только ссылки на отдельные лоты/объявления
              if (
                fullUrl.includes('/lots/') ||
                fullUrl.includes('/inventory/')
              ) {
                carLinks.add(fullUrl);
              }
            }
          });

          return Array.from(carLinks);
        })) as string[];

        // Добавляем ссылки с текущей страницы
        pageLinks.forEach((link: string) => allLinks.add(link));
        this.logger.log(
          `Найдено ссылок на странице ${currentPage}: ${pageLinks.length}`,
        );

        // Проверяем, есть ли следующая страница
        const nextPageInfo = await page.evaluate(() => {
          // Ищем кнопку ">" для перехода на следующую страницу
          const nextButton = Array.from(
            document.querySelectorAll('.pagination a'),
          ).find((el) => {
            const text = el.textContent?.trim() || '';
            return text === '>' || text === '>>';
          });

          if (!nextButton) {
            return { hasNext: false, isVisible: false };
          }

          // Проверяем, не скрыта ли кнопка
          const parent = nextButton.parentElement;
          const isHidden = parent?.classList.contains('hide_option') || false;
          const isVisible = !isHidden;

          return { hasNext: true, isVisible, element: null };
        });

        // Если кнопка следующей страницы видима, кликаем на неё
        if (nextPageInfo.hasNext && nextPageInfo.isVisible) {
          try {
            // Находим кнопку ">" и кликаем
            const nextButtonClicked = await page.evaluate(() => {
              const buttons = Array.from(
                document.querySelectorAll('.pagination a'),
              );
              const nextBtn = buttons.find((el) => {
                const text = el.textContent?.trim() || '';
                return text === '>';
              });

              if (nextBtn && nextBtn.parentElement) {
                const parent = nextBtn.parentElement;
                if (!parent.classList.contains('hide_option')) {
                  (nextBtn as HTMLElement).click();
                  return true;
                }
              }
              return false;
            });

            if (nextButtonClicked) {
              // Ждем загрузки следующей страницы
              await new Promise((resolve) => setTimeout(resolve, 3000));
              currentPage++;
            } else {
              hasMorePages = false;
            }
          } catch (error) {
            this.logger.warn(
              `Ошибка при переходе на следующую страницу: ${(error as Error).message}`,
            );
            hasMorePages = false;
          }
        } else {
          // Нет следующей страницы
          hasMorePages = false;
        }
      }

      result.links = Array.from(allLinks);
      result.total = result.links.length;

      this.logger.log(
        `Всего найдено ссылок на ${currentPage} страницах: ${result.total}`,
      );

      await browser.close();
    } catch (error) {
      result.errors++;
      result.errorsList.push({
        url: searchUrl,
        error: (error as Error).message,
      });
      this.logger.error(
        `Ошибка при парсинге ссылок: ${(error as Error).message}`,
      );
      if (browser) {
        await browser.close();
      }
    }

    return result;
  }

  /**
   * Парсит данные автомобиля со страницы (общая логика)
   */
  private async parseCarFromPage(
    page: any,
    url: string,
  ): Promise<Partial<Car>> {
    // Ждем загрузки основных элементов
    await page.waitForSelector('h1', { timeout: 30000 });

    // Определяем тип листинга
    const listingType = await this.determineListingType(page, url);

    // Извлекаем данные
    const title = await this.extractTitle(page);
    const prices = await this.extractPrices(page, listingType);
    const images = await this.extractImages(page);
    const description = await this.extractDescription(page);
    const location = await this.extractLocation(page);
    const carData = await this.extractCarData(page);

    // Создаем объект автомобиля
    const carDataToSave: Partial<Car> = {
      title,
      url,
      brand: carData.brand,
      model: carData.model,
      year: carData.year,
      mileage: carData.mileage || 0,
      transmission: carData.transmission || '',
      engineVolume: carData.engineVolume || 0,
      description,
      images,
      location,
      price: prices.price,
      startingPrice: prices.startingPrice,
      listingType,
      status: 'active',
      lastChecked: new Date(),
    };

    return carDataToSave;
  }

  /**
   * Парсит и сохраняет автомобиль из RM Sotheby's
   */
  async parseAndSave(url: string): Promise<Car> {
    if (!url.includes('rmsothebys.com')) {
      throw new Error('URL должен быть с домена rmsothebys.com');
    }

    let browser: any;

    try {
      browser = await PuppeteerExtra.launch({
        headless: false,
        defaultViewport: null,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      const incognitoContext = await browser.createBrowserContext();
      const page = await incognitoContext.newPage();
      await page.setUserAgent(USER_AGENT);

      await page.setExtraHTTPHeaders({
        'accept-language': 'en-US,en;q=0.9',
      });

      this.logger.log(`Парсинг автомобиля с URL: ${url}`);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 0 });

      // Используем общую логику парсинга
      const carDataToSave = await this.parseCarFromPage(page, url);

      // Сохраняем или обновляем в базе данных
      const car = await this.carModel.findOneAndUpdate({ url }, carDataToSave, {
        upsert: true,
        new: true,
      });

      await browser.close();
      return car;
    } catch (error) {
      this.logger.error(`Ошибка при парсинге: ${(error as Error).message}`);
      if (browser) {
        await browser.close();
      }
      throw error;
    }
  }

  /**
   * Извлекает заголовок
   */
  private async extractTitle(page: any): Promise<string> {
    return await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      return h1?.textContent?.trim() || document.title || '';
    });
  }

  /**
   * Определяет тип листинга: auction или listing (Private Sales)
   */
  private async determineListingType(
    page: any,
    url: string,
  ): Promise<'auction' | 'listing'> {
    return await page.evaluate((pageUrl: string) => {
      // Проверяем URL на наличие маркеров Private Sales
      if (pageUrl.includes('/ps00/') || pageUrl.includes('/private-sales/')) {
        return 'listing';
      }

      // Ищем ключевые слова, указывающие на аукцион
      const bodyText = document.body?.textContent?.toLowerCase() || '';
      const title = document.title.toLowerCase();

      const auctionKeywords = [
        'auction',
        'lot',
        'bid',
        'estimate',
        'reserve',
        'sale date',
        'auction date',
      ];

      const hasAuctionKeywords = auctionKeywords.some(
        (keyword) => bodyText.includes(keyword) || title.includes(keyword),
      );

      // Проверяем наличие элементов, характерных для аукционов
      const hasAuctionElements =
        !!document.querySelector('[class*="auction"]') ||
        !!document.querySelector('[class*="lot"]') ||
        !!document.querySelector('[class*="bid"]') ||
        !!document.querySelector('[class*="estimate"]');

      // Дополнительные маркеры для Private Sales
      const privateSalesKeywords = [
        'private sales',
        'motor vehicles available',
        'recently sold',
        'discreet sourcing',
        'make an offer',
      ];
      const hasPrivateSalesKeywords = privateSalesKeywords.some(
        (keyword) => bodyText.includes(keyword) || title.includes(keyword),
      );

      if (
        hasPrivateSalesKeywords &&
        !hasAuctionKeywords &&
        !hasAuctionElements
      ) {
        return 'listing';
      }

      return hasAuctionKeywords || hasAuctionElements ? 'auction' : 'listing';
    }, url);
  }

  /**
   * Извлекает цены (price и startingPrice)
   */
  private async extractPrices(
    page: any,
    listingType: 'auction' | 'listing',
  ): Promise<{
    price?: { USD?: number; EUR?: number; RUB?: number; GBP?: number };
    startingPrice?: { USD?: number; EUR?: number; RUB?: number; GBP?: number };
  }> {
    return await page.evaluate((type: string) => {
      const result: {
        price?: {
          USD?: number;
          EUR?: number;
          RUB?: number;
          GBP?: number;
        };
        startingPrice?: {
          USD?: number;
          EUR?: number;
          RUB?: number;
          GBP?: number;
        };
      } = {};

      // Функция для парсинга цены из текста
      // Возвращает min/max для диапазонов или value для одиночных цен
      const parsePrice = (
        text: string,
      ): {
        value?: number;
        min?: number;
        max?: number;
        currency: 'USD' | 'EUR' | 'RUB' | 'GBP';
        isRange: boolean;
      } | null => {
        const textLower = text.toLowerCase();

        // Определяем валюту
        let currency: 'USD' | 'EUR' | 'RUB' | 'GBP' = 'USD';
        if (
          textLower.includes('€') ||
          textLower.includes('eur') ||
          textLower.includes('euro')
        ) {
          currency = 'EUR';
        } else if (textLower.includes('$') || textLower.includes('usd')) {
          currency = 'USD';
        } else if (textLower.includes('£') || textLower.includes('gbp')) {
          currency = 'GBP';
        } else if (textLower.includes('chf')) {
          currency = 'USD'; // CHF конвертируем в USD
        }

        // Определяем курс конвертации только для CHF (GBP теперь отдельная валюта)
        const conversionRate = textLower.includes('chf') ? 1.1 : 1;

        // Ищем диапазон цен
        const rangePatterns = [
          /[\$€£]\s*([\d,]+)\s*-\s*[\$€£]\s*([\d,]+)/,
          /([\d,]+)\s*-\s*([\d,]+)\s*[\$€£]/,
          /([\d,]+)\s*-\s*([\d,]+)/,
        ];

        for (const pattern of rangePatterns) {
          const rangeMatch = text.match(pattern);
          if (rangeMatch) {
            const min = parseInt(rangeMatch[1].replace(/,/g, ''), 10);
            const max = parseInt(rangeMatch[2].replace(/,/g, ''), 10);

            // Фильтруем годы в диапазонах
            if ((min >= 1900 && min <= 2099) || (max >= 1900 && max <= 2099)) {
              continue;
            }

            // Фильтруем слишком маленькие значения
            if (min < 100 || max < 100) {
              continue;
            }

            if (min && max && min <= max) {
              return {
                min: Math.round(min * conversionRate),
                max: Math.round(max * conversionRate),
                currency,
                isRange: true,
              };
            }
          }
        }

        // Ищем одиночную цену
        const priceMatch = text.match(/[\$€£]?\s*([\d,]+)/);
        if (priceMatch) {
          const numericValue = parseInt(priceMatch[1].replace(/,/g, ''), 10);

          // Фильтруем годы (1900-2099) - не считаем их ценами
          if (numericValue >= 1900 && numericValue <= 2099) {
            return null;
          }

          // Фильтруем слишком маленькие значения (меньше 100) - вероятно не цена
          if (numericValue < 100) {
            return null;
          }

          const value = Math.round(numericValue * conversionRate);
          return { value, currency, isRange: false };
        }

        return null;
      };

      // Вспомогательная функция для записи parsed цены в result
      const setPrice = (
        parsed: {
          value?: number;
          min?: number;
          max?: number;
          currency: 'USD' | 'EUR' | 'RUB' | 'GBP';
          isRange: boolean;
        },
        isListing: boolean,
      ) => {
        if (
          parsed.isRange &&
          parsed.min !== undefined &&
          parsed.max !== undefined
        ) {
          // Для диапазона: min в startingPrice, max в price
          if (!result.startingPrice) result.startingPrice = {};
          if (!result.price) result.price = {};
          if (!result.startingPrice[parsed.currency]) {
            result.startingPrice[parsed.currency] = parsed.min;
          }
          if (!result.price[parsed.currency]) {
            result.price[parsed.currency] = parsed.max;
          }
        } else if (parsed.value !== undefined) {
          // Для одиночной цены
          if (isListing) {
            if (!result.price) result.price = {};
            if (!result.price[parsed.currency]) {
              result.price[parsed.currency] = parsed.value;
            }
          } else {
            if (!result.startingPrice) result.startingPrice = {};
            if (!result.startingPrice[parsed.currency]) {
              result.startingPrice[parsed.currency] = parsed.value;
            }
          }
        }
      };

      // Вспомогательная функция для проверки, является ли текст ценой
      const isPriceText = (text: string): boolean => {
        const textLower = text.toLowerCase();

        // Пропускаем если это "Price Upon Request" или похожее
        if (
          textLower.includes('price upon request') ||
          textLower.includes('upon request') ||
          (textLower.includes('price') && textLower.includes('request'))
        ) {
          return false;
        }

        // Требуем наличие символа валюты для признания текста ценой
        const hasCurrencySymbol =
          text.includes('$') || text.includes('€') || text.includes('£');

        if (!hasCurrencySymbol) return false;

        return (
          !!text.match(/[\$€£]?\s*[\d,]+/) ||
          textLower.includes('usd') ||
          textLower.includes('eur') ||
          textLower.includes('gbp') ||
          textLower.includes('chf')
        );
      };

      // Вспомогательная функция для проверки, нужно ли пропустить текст
      const shouldSkipText = (text: string, isListing: boolean): boolean => {
        const textLower = text.toLowerCase();
        if (textLower.includes('estimate')) return true;
        if (
          textLower.includes('price upon request') ||
          textLower.includes('upon request')
        )
          return true;
        if (textLower.includes('current') || textLower.includes('bid'))
          return false;
        if (!isListing && textLower.includes('asking')) return true;
        return false;
      };

      const isListing = type === 'listing';
      const estimateModal = document.querySelector('#modal-estimates');

      // Извлекаем estimate (startingPrice) для аукционов
      if (!isListing) {
        // Способ 1: Ищем в модальном окне с estimates (приоритет)
        if (estimateModal) {
          estimateModal.querySelectorAll('p.heading-subtitle').forEach((p) => {
            const text = p.textContent?.trim() || '';
            if (!isPriceText(text)) return;
            const parsed = parsePrice(text);
            if (parsed) setPrice(parsed, false);
          });
        }

        // Способ 2: Ищем элемент с классом "estimate"
        if (!result.startingPrice) {
          const estimateElement = document.querySelector('.estimate');
          if (estimateElement) {
            const text = estimateElement.textContent?.trim() || '';
            const parsed = parsePrice(text);
            if (parsed) setPrice(parsed, false);
          }
        }
      }

      // Ищем цены в элементах heading-subtitle на странице (для обоих типов)
      document
        .querySelectorAll(
          'p.heading-subtitle, div.heading-subtitle, span.heading-subtitle',
        )
        .forEach((block) => {
          if (estimateModal?.contains(block)) return;
          const text = block.textContent?.trim() || '';
          if (!text || !isPriceText(text) || shouldSkipText(text, isListing))
            return;
          const parsed = parsePrice(text);
          if (parsed) setPrice(parsed, isListing);
        });

      // Ищем цены в элементах body-text (для listing типа, например "£950,000 GBP | Asking")
      document.querySelectorAll('[class*="body-text"]').forEach((block) => {
        if (estimateModal?.contains(block)) return;
        const text = block.textContent?.trim() || '';
        if (!text || !isPriceText(text) || shouldSkipText(text, isListing))
          return;
        const parsed = parsePrice(text);
        if (parsed) setPrice(parsed, isListing);
      });

      // Ищем цены в элементах с классами price, bid, amount, asking
      const priceSelectors = [
        '[class*="price"]:not(.estimate)',
        '[class*="bid"]',
        '[class*="amount"]',
        '[class*="asking"]',
      ];

      for (const selector of priceSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          const text = element.textContent?.trim() || '';
          if (!text || element.classList.contains('estimate')) continue;
          if (shouldSkipText(text, isListing)) continue;

          const parsed = parsePrice(text);
          if (parsed && parsed.value !== undefined) {
            if (!result.price) result.price = {};
            result.price[parsed.currency] = parsed.value;
            break;
          }
        }
        if (result.price) break;
      }

      // Для listing: если не нашли price, но есть startingPrice, используем его как price
      if (isListing && result.startingPrice && !result.price) {
        result.price = result.startingPrice;
        result.startingPrice = undefined;
      }

      return result;
    }, listingType);
  }

  /**
   * Извлекает изображения в высоком разрешении
   */
  private async extractImages(page: any): Promise<string[]> {
    return await page.evaluate(async () => {
      const images: string[] = [];
      const processedSrcs = new Set<string>();

      // Try to get images from nanoGallery first (high-res)
      const nanoGallery = document.querySelector('#nanoGallery');
      if (nanoGallery) {
        const nanoImages =
          nanoGallery.querySelectorAll<HTMLImageElement>('img[data-ngsrc]');
        nanoImages.forEach((img) => {
          const src = img.getAttribute('data-ngsrc');
          if (src && !processedSrcs.has(src)) {
            // Фильтруем placeholder изображения
            if (
              !src.startsWith('data:image/') &&
              !src.includes('placeholder')
            ) {
              images.push(src);
              processedSrcs.add(src);
            }
          }
        });
      }

      // Try to get images from data-ngsrc (high-res)
      if (images.length === 0) {
        const ngSrcImages =
          document.querySelectorAll<HTMLImageElement>('img[data-ngsrc]');
        ngSrcImages.forEach((img) => {
          const src = img.getAttribute('data-ngsrc');
          if (src && !processedSrcs.has(src)) {
            // Фильтруем placeholder изображения
            if (
              !src.startsWith('data:image/') &&
              !src.includes('placeholder')
            ) {
              images.push(src);
              processedSrcs.add(src);
            }
          }
        });
      }

      // If no images found or not enough, try other selectors
      if (images.length === 0) {
        const imageSelectors = [
          'img[src*="rmsothebys"]',
          '[class*="gallery"] img',
          '[class*="image"] img',
          '[class*="photo"] img',
        ];

        for (const selector of imageSelectors) {
          const imgElements =
            document.querySelectorAll<HTMLImageElement>(selector);
          imgElements.forEach((img) => {
            let src = img.src || img.getAttribute('data-src') || '';
            if (src && !src.includes('logo') && !src.includes('icon')) {
              // Фильтруем placeholder изображения
              if (
                src.startsWith('data:image/') ||
                src.includes('placeholder')
              ) {
                return;
              }
              if (!src.startsWith('http')) {
                if (src.startsWith('//')) {
                  src = 'https:' + src;
                } else if (src.startsWith('/')) {
                  src = 'https://rmsothebys.com' + src;
                }
              }
              if (src && !processedSrcs.has(src) && src.startsWith('http')) {
                images.push(src);
                processedSrcs.add(src);
              }
            }
          });
          if (images.length > 0) break;
        }
      }

      // Try to click on the main image to open a carousel and extract images from there
      try {
        const mainImage = document.querySelector(
          '.lot-image-main img, .gallery-item img, [class*="gallery"] img:first-child',
        );
        if (mainImage) {
          (mainImage as HTMLElement).click();
          // Wait for the carousel to open and load images
          await new Promise((resolve) => setTimeout(resolve, 2000));

          const carouselImages = document.querySelectorAll<HTMLImageElement>(
            '.pswp__img, .mfp-img, [class*="carousel"] img, [class*="lightbox"] img',
          );
          carouselImages.forEach((img) => {
            const imgSrc = img.src || img.getAttribute('data-src') || '';
            if (imgSrc && !processedSrcs.has(imgSrc)) {
              // Фильтруем placeholder изображения
              if (
                !imgSrc.startsWith('data:image/') &&
                !imgSrc.includes('placeholder')
              ) {
                images.push(imgSrc);
                processedSrcs.add(imgSrc);
              }
            }
          });

          // Close the carousel if possible
          const closeButton = document.querySelector(
            '.pswp__button--close, .mfp-close, [class*="close"]',
          );
          if (closeButton) {
            (closeButton as HTMLElement).click();
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        }
      } catch (error) {
        // Если не удалось открыть карусель, продолжаем
        console.log('Could not open carousel:', error);
      }

      // Финальная фильтрация: удаляем placeholder изображения и дубликаты
      return images.filter((src) => {
        return (
          src &&
          !src.startsWith('data:image/') &&
          !src.includes('placeholder') &&
          src.startsWith('http')
        );
      });
    });
  }

  /**
   * Извлекает описание
   */
  private async extractDescription(page: any): Promise<string> {
    return await page.evaluate(() => {
      const descriptionSelectors = [
        '[class*="description"]',
        '[class*="detail"]',
        '[class*="content"]',
        'article',
        '.main-content',
      ];

      for (const selector of descriptionSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          const text = element.textContent?.trim();
          if (text && text.length > 50) {
            return text;
          }
        }
      }

      return '';
    });
  }

  /**
   * Извлекает локацию
   */
  private async extractLocation(page: any): Promise<{
    city?: string;
    country?: string;
  }> {
    return await page.evaluate(() => {
      const location: { city?: string; country?: string } = {};

      // Список штатов США
      const usStates = [
        'Alabama',
        'Alaska',
        'Arizona',
        'Arkansas',
        'California',
        'Colorado',
        'Connecticut',
        'Delaware',
        'Florida',
        'Georgia',
        'Hawaii',
        'Idaho',
        'Illinois',
        'Indiana',
        'Iowa',
        'Kansas',
        'Kentucky',
        'Louisiana',
        'Maine',
        'Maryland',
        'Massachusetts',
        'Michigan',
        'Minnesota',
        'Mississippi',
        'Missouri',
        'Montana',
        'Nebraska',
        'Nevada',
        'New Hampshire',
        'New Jersey',
        'New Mexico',
        'New York',
        'North Carolina',
        'North Dakota',
        'Ohio',
        'Oklahoma',
        'Oregon',
        'Pennsylvania',
        'Rhode Island',
        'South Carolina',
        'South Dakota',
        'Tennessee',
        'Texas',
        'Utah',
        'Vermont',
        'Virginia',
        'Washington',
        'West Virginia',
        'Wisconsin',
        'Wyoming',
        'District of Columbia',
      ];

      // Ищем локацию в структуре с классом .ids (Chassis No., Registration, Location)
      const idsBlocks = document.querySelectorAll('.ids .body-text--copy');

      for (const block of idsBlocks) {
        const label = block.querySelector('.idlabel')?.textContent?.trim();
        const dataElement = block.querySelector('.iddata');

        if (label && dataElement && label.toLowerCase().includes('location')) {
          // Проверяем наличие флага США
          const flagImg = dataElement.querySelector('img');
          const flagSrc = flagImg?.getAttribute('src') || '';
          const flagAlt = flagImg?.getAttribute('alt')?.toLowerCase() || '';
          const isUSFlag =
            flagImg &&
            (flagSrc.includes('/us.png') ||
              flagAlt.includes('united states') ||
              flagAlt.includes('usa'));

          // Получаем текст локации, убираем флаг и символ "|" если они есть
          let locationText = dataElement.textContent?.trim() || '';
          locationText = locationText.replace(/^\s*\|?\s*/, '').trim();

          // Если есть флаг США, устанавливаем страну сразу
          if (isUSFlag) {
            location.country = 'United States';
          }

          // Пробуем распарсить локацию (например, "Burgerveen, Netherlands" или "Culver City, California")
          const parts = locationText
            .split(',')
            .map((p) => p.trim())
            .filter((p) => p);

          if (parts.length >= 2) {
            location.city = parts[0];
            // Если страна не установлена через флаг
            if (!location.country) {
              const lastPart = parts[parts.length - 1];
              // Проверяем, является ли последняя часть штатом США
              if (usStates.includes(lastPart)) {
                location.country = 'United States';
              } else {
                location.country = lastPart;
              }
            }
          } else if (parts.length === 1) {
            location.city = parts[0];
          }
          break;
        }
      }

      // Если не нашли в .ids, пробуем другие селекторы
      if (!location.city && !location.country) {
        const locationSelectors = [
          '[class*="location"]',
          '[class*="venue"]',
          '[class*="city"]',
        ];

        for (const selector of locationSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            const text = element.textContent?.trim();
            if (text) {
              // Пробуем распарсить локацию (например, "Paris, France")
              const parts = text.split(',').map((p) => p.trim());
              if (parts.length >= 2) {
                location.city = parts[0];
                location.country = parts[parts.length - 1];
              } else {
                location.city = text;
              }
              break;
            }
          }
        }
      }

      return location;
    });
  }

  /**
   * Извлекает данные автомобиля (бренд, модель, год и т.д.)
   */
  private async extractCarData(page: any): Promise<{
    brand?: string;
    model?: string;
    year?: number;
    mileage?: number;
    transmission?: string;
    engineVolume?: number;
  }> {
    return await page.evaluate((potentialBrands: string[]) => {
      const data: {
        brand?: string;
        model?: string;
        year?: number;
        mileage?: number;
        transmission?: string;
        engineVolume?: number;
      } = {};

      // Извлекаем из заголовка или спецификаций
      const title = document.querySelector('h1')?.textContent || '';
      const specsText = document.body?.textContent || '';

      // Пробуем найти год в заголовке (например, "1965 Ferrari 275 GTB")
      const yearMatch = title.match(/\b(19|20)\d{2}\b/);
      if (yearMatch) {
        data.year = parseInt(yearMatch[0], 10);
      }

      // Пробуем найти бренд и модель из заголовка
      const titleParts = title.split(/\s+/);
      if (titleParts.length > 0) {
        for (const brand of potentialBrands) {
          if (title.toLowerCase().includes(brand.toLowerCase())) {
            data.brand = brand;
            // Модель - обычно следующее слово или слова после года и бренда
            // Удаляем год и бренд из заголовка
            let modelText = title;
            if (yearMatch) {
              modelText = modelText.replace(yearMatch[0], '').trim();
            }
            const brandIndex = modelText
              .toLowerCase()
              .indexOf(brand.toLowerCase());
            if (brandIndex !== -1) {
              modelText = modelText.substring(brandIndex + brand.length).trim();
            }
            // Убираем "| Private Sales" и подобные суффиксы
            modelText = modelText.replace(/\s*\|\s*.*$/, '').trim();
            if (modelText) {
              data.model = modelText;
            }
            break;
          }
        }
      }

      // Пробуем найти пробег
      const mileageMatches = [
        specsText.match(/(\d{1,3}(?:[,\s]?\d{3})*)\s*(?:km|kilometers?)/i),
        specsText.match(/(\d{1,3}(?:[,\s]?\d{3})*)\s*(?:miles?|mi)/i),
        specsText.match(/mileage[:\s]+(\d{1,3}(?:[,\s]?\d{3})*)/i),
      ].filter((m) => m !== null);

      if (mileageMatches.length > 0) {
        const mileageMatch = mileageMatches[0];
        if (mileageMatch) {
          const mileage = parseInt(mileageMatch[1].replace(/[,\s]/g, ''), 10);
          // Если найдено в милях, конвертируем в км (1 миля = 1.609 км)
          if (
            mileageMatch[0].toLowerCase().includes('mile') ||
            mileageMatch[0].toLowerCase().includes('mi')
          ) {
            data.mileage = Math.round(mileage * 1.609);
          } else {
            data.mileage = mileage;
          }
        }
      }

      // Пробуем найти трансмиссию
      if (specsText.match(/\b(manual|automatic|MT|AT)\b/i)) {
        const transmissionMatch = specsText.match(
          /\b(manual|automatic|MT|AT)\b/i,
        );
        if (transmissionMatch) {
          const trans = transmissionMatch[1].toLowerCase();
          if (trans.includes('manual') || trans === 'mt') {
            data.transmission = 'MT';
          } else if (trans.includes('automatic') || trans === 'at') {
            data.transmission = 'AT';
          }
        }
      }

      // Пробуем найти объем двигателя (ищем более точные паттерны)
      // Сначала ищем "3.0-lire" или "3.0 L" или "3.0-litre"
      const engineMatches = [
        specsText.match(/(\d+\.?\d*)\s*(?:-)?(?:litre|liter|L)(?:s)?\b/i),
        specsText.match(/(\d+\.?\d*)\s*L\b/i),
        specsText.match(/\b(\d+\.?\d*)\s*(?:liter|litre|L)\b/i),
      ].filter((m) => m !== null);

      // Берем первое совпадение, но проверяем, что значение разумное (0.5-20 литров)
      if (engineMatches.length > 0) {
        const engineMatch = engineMatches[0];
        if (engineMatch) {
          const volume = parseFloat(engineMatch[1]);
          if (volume >= 0.5 && volume <= 20) {
            data.engineVolume = volume;
          }
        }
      }

      // Если не нашли, пробуем найти в описании или спецификациях
      if (!data.engineVolume) {
        const engineTextMatch = specsText.match(
          /(\d+\.?\d*)\s*(?:L|l|liters?|litres?)\b/i,
        );
        if (engineTextMatch) {
          const volume = parseFloat(engineTextMatch[1]);
          if (volume >= 0.5 && volume <= 20) {
            data.engineVolume = volume;
          }
        }
      }

      return data;
    }, POTENTIAL_BRANDS);
  }
}
