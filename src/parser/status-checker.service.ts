import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery } from 'mongoose';
import type { Browser, Page } from 'puppeteer';
import { Car, CarDocument } from '../schemas/car.schema';
import { StatusCheckResult } from './interfaces/status-check-result.interface';
import { CaptchaService } from './captcha.service';
import { TelegramService } from './telegram.service';
import { CaptchaSessionService } from './captcha-session.service';
import {
  createBrowser,
  createPage,
  setupPage,
  navigateWithRetry,
  isIpBlocked,
  randomDelay,
  normalizeAvitoUrl,
} from './utils/browser-helper';

export type AdStatus = 'active' | 'sold' | 'removed' | 'unknown';

@Injectable()
export class StatusCheckerService {
  constructor(
    @InjectModel(Car.name) private carModel: Model<CarDocument>,
    private readonly captchaService: CaptchaService,
    private readonly telegramService: TelegramService,
    private readonly captchaSessionService: CaptchaSessionService,
  ) {}

  /** Опции для ручного решения капчи с телефона (Telegram + страница с тапами) */
  private get manualCaptchaOptions() {
    if (!this.telegramService.isEnabled()) {
      return undefined;
    }
    return {
      onManualCaptchaWait: async (page: Page): Promise<string | null> => {
        const sessionId =
          this.captchaSessionService.createSession(page);
        const screenshot = await page.screenshot({ type: 'png' });
        await this.telegramService.sendCaptchaToPhone(
          sessionId,
          Buffer.from(screenshot),
        );
        return sessionId;
      },
      getPendingClicks: (sessionId: string) =>
        Promise.resolve(
          this.captchaSessionService.getAndTakeClicks(sessionId),
        ),
    };
  }

  /**
   * Проверяет статус объявления на Avito
   */
  async checkAvitoStatus(url: string): Promise<AdStatus> {
    let browser: Browser | undefined;
    let page: Page | undefined;

    try {
      // Нормализуем URL, удаляя параметры отслеживания
      const normalizedUrl = normalizeAvitoUrl(url);
      console.log(`[AvitoChecker] Checking status for URL: ${normalizedUrl}`);
      browser = await createBrowser(true); // headless

      // Отключаем инкогнито для проверок статуса, чтобы избежать проблем с stealth plugin
      page = await createPage(browser, false); // Не используем инкогнито для быстрых проверок
      await setupPage(page);

      // Используем улучшенную навигацию с retry и автоматическим решением капчи
      const navigated = await navigateWithRetry(
        page,
        normalizedUrl,
        3,
        this.captchaService,
        this.manualCaptchaOptions,
      );
      if (!navigated) {
        console.error(
          '[AvitoChecker] Failed to navigate to page after retries',
        );
        return 'unknown';
      }

      // Проверяем, не заблокирован ли IP
      const blocked = await isIpBlocked(page);
      if (blocked) {
        console.warn(
          '[AvitoChecker] IP blocked detected. Returning unknown status.',
        );
        return 'unknown';
      }

      console.log('[AvitoChecker] Page loaded, waiting for content...');

      // Ждем загрузки основных элементов страницы
      try {
        await page.waitForSelector('h1, [data-marker="item-view"], main', {
          timeout: 10000,
        });
      } catch {
        console.warn('[AvitoChecker] Timeout waiting for main elements');
      }

      // Добавляем небольшую задержку для полной загрузки контента
      await randomDelay(2000, 2000);

      console.log('[AvitoChecker] Checking status...');

      // Проверяем признаки удаленного/проданного объявления
      const status = await page.evaluate(() => {
        const bodyText = (document.body?.textContent || '').toLowerCase();
        const title = document.title.toLowerCase();
        const bodyTextContent = document.body?.textContent?.trim() || '';

        console.log('Body text preview:', bodyText.substring(0, 500));
        console.log('Page title:', title);

        // ПРИОРИТЕТ 1: СНАЧАЛА проверяем признаки снятия с публикации/удаления
        // Это важнее, чем проверка наличия элементов
        const hasRemovedMarkers =
          !!document.querySelector('[data-marker*="not-found"]') ||
          !!document.querySelector('[data-marker*="notFound"]') ||
          !!document.querySelector('.not-found') ||
          !!document.querySelector('.NotFoundPage') ||
          !!document.querySelector('[data-marker*="removed"]') ||
          !!document.querySelector('[data-marker*="unpublished"]');

        const hasRemovedText =
          bodyText.includes('объявление снято с публикации') ||
          bodyText.includes('снято с публикации') ||
          bodyText.includes('объявление снято') ||
          bodyText.includes('объявление удалено') ||
          bodyText.includes('объявление не найдено') ||
          bodyText.includes('страница не найдена') ||
          bodyText.includes('объявление недоступно') ||
          bodyText.includes('объявление было снято') ||
          bodyText.includes('объявление снято с продажи') ||
          (title.includes('404') && title.length < 50) ||
          (bodyText.includes('не найдено') && bodyTextContent.length < 2000);

        if (hasRemovedMarkers || hasRemovedText) {
          console.log('Status: removed (removed/unpublished detected)');
          console.log('Removed markers:', hasRemovedMarkers);
          console.log('Removed text found:', hasRemovedText);
          return 'removed';
        }

        // ПРИОРИТЕТ 2: Проверяем признаки проданного объявления
        const soldMarkers =
          !!document.querySelector('[data-marker="item-view/sold"]') ||
          !!document.querySelector('[data-marker*="sold"]') ||
          !!document.querySelector('.item-view-sold') ||
          !!document.querySelector('.sold-label') ||
          !!document.querySelector('[data-marker*="sold-out"]');

        const soldText =
          (bodyText.includes('товар продан') &&
            !bodyText.includes('не продан')) ||
          (bodyText.includes('продано') &&
            !!document.querySelector('[data-marker="item-view/sold"]')) ||
          bodyText.includes('автомобиль продан');

        if (soldMarkers || soldText) {
          console.log('Status: sold');
          return 'sold';
        }

        // ПРИОРИТЕТ 3: Проверяем наличие основных элементов объявления
        const hasTitle = !!document.querySelector('h1');
        const hasPrice =
          !!document.querySelector('[itemprop="price"]') ||
          !!document.querySelector('[data-marker="item-view/item-price"]') ||
          !!document.querySelector('[data-marker="item-view/price"]') ||
          !!document.querySelector('.price-value') ||
          !!document.querySelector('.js-item-price');
        const hasDescription =
          !!document.querySelector('[itemprop="description"]') ||
          !!document.querySelector(
            '[data-marker="item-view/item-description"]',
          ) ||
          !!document.querySelector('.item-description-text') ||
          !!document.querySelector('[data-marker="item-view/text"]');
        const hasImages =
          !!document.querySelector('[data-marker="image-frame"]') ||
          !!document.querySelector('.gallery-img') ||
          !!document.querySelector('img[itemprop="image"]') ||
          !!document.querySelector('[data-marker="image-viewer/image"]');
        const hasMainContent =
          !!document.querySelector('[data-marker="item-view"]') ||
          !!document.querySelector('main') ||
          !!document.querySelector('.item-view');

        console.log('Elements check:', {
          hasTitle,
          hasPrice,
          hasDescription,
          hasImages,
          hasMainContent,
        });

        // Если есть основные элементы - объявление активно
        if (
          hasTitle &&
          (hasPrice || hasDescription || hasImages || hasMainContent)
        ) {
          console.log('Status: active (has main elements)');
          return 'active';
        }

        // Дополнительная проверка - может быть страница загружается
        const hasAnyContent =
          bodyTextContent.length > 500 &&
          (hasMainContent || document.querySelector('main') !== null);

        if (hasAnyContent) {
          console.log('Status: active (has content)');
          return 'active';
        }

        console.log('Status: unknown (no clear indicators)');
        return 'unknown';
      });

      console.log(`[AvitoChecker] Final status: ${status}`);
      return status as AdStatus;
    } catch (error) {
      console.error(`[AvitoChecker] Error checking Avito status:`, error);
      return 'unknown';
    } finally {
      // Закрываем страницу перед закрытием браузера
      if (page) {
        try {
          await page.close();
        } catch (closeError) {
          console.warn('[AvitoChecker] Error closing page:', closeError);
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
          console.warn('[AvitoChecker] Error closing browser:', closeError);
        }
      }
    }
  }

  /**
   * Проверяет статус объявления на Auto.ru
   */
  async checkAutoRuStatus(url: string): Promise<AdStatus> {
    let browser: Browser | undefined;
    let page: Page | undefined;

    try {
      console.log(`[AutoRuChecker] Checking status for URL: ${url}`);
      browser = await createBrowser(true); // headless

      // Отключаем инкогнито для проверок статуса, чтобы избежать проблем с stealth plugin
      page = await createPage(browser, false); // Не используем инкогнито для быстрых проверок
      await setupPage(page);

      // Используем улучшенную навигацию с retry и автоматическим решением капчи
      const navigated = await navigateWithRetry(
        page,
        url,
        3,
        this.captchaService,
        this.manualCaptchaOptions,
      );
      if (!navigated) {
        console.error(
          '[AutoRuChecker] Failed to navigate to page after retries',
        );
        return 'unknown';
      }

      // Проверяем, не заблокирован ли IP
      const blocked = await isIpBlocked(page);
      if (blocked) {
        console.warn(
          '[AutoRuChecker] IP blocked detected. Returning unknown status.',
        );
        return 'unknown';
      }

      console.log('[AutoRuChecker] Page loaded, checking status...');

      const status = await page.evaluate(() => {
        const bodyText = (document.body?.textContent || '').toLowerCase();

        // Признаки удаленного объявления
        if (
          bodyText.includes('объявление не найдено') ||
          bodyText.includes('404') ||
          bodyText.includes('страница не найдена') ||
          document.querySelector('.NotFoundPage')
        ) {
          return 'removed';
        }

        // Признаки проданного объявления
        if (
          bodyText.includes('продано') ||
          bodyText.includes('снято с продажи') ||
          document.querySelector('[data-ftid="component_sold"]') ||
          document.querySelector('.CardSold')
        ) {
          return 'sold';
        }

        // Проверяем наличие основных элементов
        const hasTitle = !!document.querySelector('h1');
        const hasSaleData = !!document.querySelector('#sale-data-attributes');

        if (hasTitle && hasSaleData) {
          return 'active';
        }

        return 'unknown';
      });

      console.log(`[AutoRuChecker] Final status: ${status}`);
      return status as AdStatus;
    } catch (error) {
      console.error(`[AutoRuChecker] Error checking Auto.ru status:`, error);
      return 'unknown';
    } finally {
      // Закрываем страницу перед закрытием браузера
      if (page) {
        try {
          await page.close();
        } catch (closeError) {
          console.warn('[AutoRuChecker] Error closing page:', closeError);
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
          console.warn('[AutoRuChecker] Error closing browser:', closeError);
        }
      }
    }
  }

  /**
   * Проверяет статус объявления по URL
   */
  async checkStatus(url: string): Promise<AdStatus> {
    if (url.includes('avito.ru')) {
      return this.checkAvitoStatus(url);
    } else if (url.includes('auto.ru')) {
      return this.checkAutoRuStatus(url);
    }
    return 'unknown';
  }

  /**
   * Обновляет статус автомобиля в базе данных
   */
  async updateCarStatus(carId: string): Promise<Car | null> {
    const car = await this.carModel.findById(carId).exec();
    if (!car) {
      return null;
    }

    const newStatus = await this.checkStatus(car.url);
    car.status = newStatus;
    car.lastChecked = new Date();

    return await car.save();
  }

  /**
   * Проверяет статус нескольких автомобилей
   */
  async checkMultipleCars(carIds: string[]): Promise<Car[]> {
    const results: Car[] = [];

    for (const carId of carIds) {
      try {
        const updatedCar = await this.updateCarStatus(carId);
        if (updatedCar) {
          results.push(updatedCar);
        }
      } catch (error) {
        console.error(`Error checking car ${carId}:`, error);
      }
    }

    return results;
  }

  /**
   * Проверяет все активные и unknown объявления старше определенного количества дней
   */
  async checkOldActiveCars(
    daysOld: number = 7,
    checkAll: boolean = false,
  ): Promise<StatusCheckResult> {
    const dateThreshold = new Date();
    dateThreshold.setDate(dateThreshold.getDate() - daysOld);

    console.log(
      `Checking cars older than ${daysOld} days. Threshold date: ${dateThreshold.toISOString()}`,
    );

    // Сначала проверяем, сколько всего объявлений
    const totalCars = await this.carModel.countDocuments({});
    const totalActive = await this.carModel.countDocuments({
      $or: [
        { status: 'active' },
        { status: 'unknown' },
        { status: { $exists: false } },
      ],
    });
    console.log(`Total cars in database: ${totalCars}`);
    console.log(
      `Total active/unknown cars (or without status): ${totalActive}`,
    );

    // Для unknown машин проверяем чаще (каждые 3 дня), для остальных - по daysOld
    const unknownDateThreshold = new Date();
    unknownDateThreshold.setDate(unknownDateThreshold.getDate() - 3);

    // Строим запрос
    let cars: CarDocument[] = [];

    if (checkAll) {
      // Проверяем все объявления
      const query: FilterQuery<CarDocument> = {
        $or: [
          { lastChecked: { $exists: false } },
          { lastChecked: { $lt: dateThreshold } },
        ],
      };
      console.log('Query (checkAll):', JSON.stringify(query, null, 2));
      const foundCars = await this.carModel.find(query).limit(50).exec();
      cars = foundCars as unknown as CarDocument[];
    } else {
      // Проверяем active и unknown с разными порогами дат
      // Используем отдельные запросы для упрощения
      const unknownQuery: FilterQuery<CarDocument> = {
        status: 'unknown',
        $or: [
          { lastChecked: { $exists: false } },
          { lastChecked: { $lt: unknownDateThreshold } },
        ],
      };

      const activeQuery: FilterQuery<CarDocument> = {
        status: 'active',
        $or: [
          { lastChecked: { $exists: false } },
          { lastChecked: { $lt: dateThreshold } },
        ],
      };

      const noStatusQuery: FilterQuery<CarDocument> = {
        status: { $exists: false },
        $or: [
          { lastChecked: { $exists: false } },
          { lastChecked: { $lt: dateThreshold } },
        ],
      };

      console.log('Queries:', {
        unknown: JSON.stringify(unknownQuery, null, 2),
        active: JSON.stringify(activeQuery, null, 2),
        noStatus: JSON.stringify(noStatusQuery, null, 2),
      });

      // Выполняем запросы отдельно для избежания проблем с типизацией
      const unknownCars = await this.carModel
        .find(unknownQuery)
        .limit(50)
        .exec();
      const activeCars = await this.carModel.find(activeQuery).limit(50).exec();
      const noStatusCars = await this.carModel
        .find(noStatusQuery)
        .limit(50)
        .exec();

      // Объединяем результаты, убирая дубликаты по ID
      const allCarsMap = new Map<string, CarDocument>();
      const allCarsList: CarDocument[] = [
        ...(unknownCars as unknown as CarDocument[]),
        ...(activeCars as unknown as CarDocument[]),
        ...(noStatusCars as unknown as CarDocument[]),
      ];
      allCarsList.forEach((car) => {
        const id = car._id?.toString() || '';
        if (id && !allCarsMap.has(id)) {
          allCarsMap.set(id, car);
        }
      });

      cars = Array.from(allCarsMap.values()).slice(0, 50);

      console.log(
        `Found ${cars.length} cars to check (unknown: ${unknownCars.length}, active: ${activeCars.length}, no status: ${noStatusCars.length})`,
      );
    }

    console.log(`Found ${cars.length} cars to check`);

    return this.processCarsCheck(cars);
  }

  /**
   * Обрабатывает проверку массива автомобилей
   */
  private async processCarsCheck(
    cars: CarDocument[],
  ): Promise<StatusCheckResult> {
    const checked: Car[] = [];
    const changed: Car[] = [];
    const stats = {
      total: 0,
      active: 0,
      sold: 0,
      removed: 0,
      unknown: 0,
      statusChanged: 0,
    };

    if (cars.length === 0) {
      console.log('No cars found to check. Returning empty result.');
      return {
        checked: [],
        stats: {
          total: 0,
          active: 0,
          sold: 0,
          removed: 0,
          unknown: 0,
          statusChanged: 0,
        },
        changed: [],
      };
    }

    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      try {
        const carId = car._id?.toString() || 'unknown';
        console.log(
          `[StatusChecker] Checking car ${i + 1}/${cars.length}: ${carId} - ${car.title}`,
        );
        const oldStatus = car.status || 'unknown';
        const newStatus = await this.checkStatus(car.url);
        const statusChanged = oldStatus !== newStatus;

        console.log(
          `[StatusChecker] Car ${carId}: ${oldStatus} -> ${newStatus} (changed: ${statusChanged})`,
        );

        car.status = newStatus;
        car.lastChecked = new Date();
        await car.save();

        checked.push(car);
        stats.total++;

        // Подсчитываем статистику по статусам
        if (newStatus === 'active') stats.active++;
        else if (newStatus === 'sold') stats.sold++;
        else if (newStatus === 'removed') stats.removed++;
        else if (newStatus === 'unknown') stats.unknown++;

        // Если статус изменился, добавляем в список измененных
        if (statusChanged) {
          stats.statusChanged++;
          changed.push(car);
        }

        // Добавляем задержку между проверками, чтобы избежать блокировок
        // Последняя машина не требует задержки
        if (i < cars.length - 1) {
          const delay = randomDelay(3000, 8000); // 3-8 секунд между запросами
          console.log(`[StatusChecker] Waiting before next check...`);
          await delay;
        }
      } catch (error) {
        const carId = car._id?.toString() || 'unknown';
        console.error(`[StatusChecker] Error checking car ${carId}:`, error);
        // Даже при ошибке добавляем небольшую задержку
        if (i < cars.length - 1) {
          await randomDelay(2000, 5000);
        }
      }
    }

    console.log('Check completed. Stats:', stats);

    return {
      checked,
      stats,
      changed,
    };
  }
}
