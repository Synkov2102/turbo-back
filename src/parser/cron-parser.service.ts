import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cron } from '@nestjs/schedule';
import { Car, CarDocument } from '../schemas/car.schema';
import {
  CRON_OLDTIMERFARM,
  CRON_RMSOTHEBYS,
  CRON_UPDATE_PRICES_RUB,
} from '../constants/cron.constants';
import { OldtimerfarmParserService } from './oldtimerfarm-parser.service';
import { RmsothebysParserService } from './rmsothebys-parser.service';
import { CarsService } from '../cars/cars.service';

@Injectable()
export class CronParserService {
  private readonly logger = new Logger(CronParserService.name);
  private isRunning = false;

  constructor(
    @InjectModel(Car.name) private carModel: Model<CarDocument>,
    private readonly oldtimerfarmParser: OldtimerfarmParserService,
    private readonly rmsothebysParser: RmsothebysParserService,
    private readonly carsService: CarsService,
  ) {}

  /**
   * Cron job для парсинга OldTimerFarm
   */
  @Cron(CRON_OLDTIMERFARM)
  async parseOldtimerfarmCron() {
    if (this.isRunning) {
      this.logger.warn('Парсинг уже выполняется, пропускаем запуск cron job');
      return;
    }

    this.logger.log('Запуск cron job для парсинга OldTimerFarm');
    await this.parseOldtimerfarm();
  }

  /**
   * Cron job для парсинга RMSothebys
   */
  @Cron(CRON_RMSOTHEBYS)
  async parseRmsothebysCron() {
    if (this.isRunning) {
      this.logger.warn('Парсинг уже выполняется, пропускаем запуск cron job');
      return;
    }

    this.logger.log('Запуск cron job для парсинга RMSothebys');
    await this.parseRmsothebys();
  }

  /**
   * Cron job для обновления цен в рублях
   */
  @Cron(CRON_UPDATE_PRICES_RUB)
  async updatePricesCron() {
    this.logger.log('Запуск cron job для обновления цен в рублях');
    try {
      const result = await this.carsService.updatePricesInRubles();
      this.logger.log(
        `Обновление цен завершено: обновлено ${result.updated} машин`,
      );
    } catch (error) {
      this.logger.error(
        `Ошибка при обновлении цен: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Парсинг OldTimerFarm: парсит актуальные объявления,
   * обновляет существующие, добавляет новые, помечает отсутствующие в новом парсе как removed.
   */
  async parseOldtimerfarm(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Парсинг OldTimerFarm уже выполняется');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();
    const listUrl =
      'https://www.oldtimerfarm.be/en/collection-cars-for-sale.php?categorie=collectiewagen';

    try {
      this.logger.log('Начало парсинга OldTimerFarm');

      // Получаем список всех URL, которые были в базе до парсинга
      const existingUrls = await this.carModel
        .find({
          url: { $regex: /oldtimerfarm\.be/i },
        })
        .select('url')
        .lean()
        .exec();
      const existingUrlsSet = new Set(
        existingUrls.map((car) => car.url.toLowerCase()),
      );

      // Парсим все авто со страницы списка
      const parseResult =
        await this.oldtimerfarmParser.parseAllCarsFromList(listUrl);

      this.logger.log(
        `Парсинг завершен: ${parseResult.parsed} обработано, ${parseResult.skipped} пропущено, ${parseResult.errors} ошибок`,
      );

      // Получаем список URL, которые были найдены при парсинге
      const parsedUrls = new Set<string>();
      for (const car of parseResult.cars) {
        if (car.url) {
          parsedUrls.add(car.url.toLowerCase());
        }
      }

      // Находим авто, которые были в базе, но не были найдены при парсинге
      const missingUrls: string[] = [];
      for (const url of existingUrlsSet) {
        if (!parsedUrls.has(url.toLowerCase())) {
          missingUrls.push(url);
        }
      }

      // Помечаем пропавшие авто как removed
      if (missingUrls.length > 0) {
        // Фильтруем только URL с oldtimerfarm.be
        const oldtimerfarmUrls = missingUrls.filter((url) =>
          /oldtimerfarm\.be/i.test(url),
        );

        if (oldtimerfarmUrls.length > 0) {
          const updateResult = await this.carModel
            .updateMany(
              {
                url: { $in: oldtimerfarmUrls },
              },
              {
                $set: {
                  status: 'removed',
                  lastChecked: new Date(),
                },
              },
            )
            .exec();

          this.logger.log(
            `Помечено как removed: ${updateResult.modifiedCount} авто с OldTimerFarm`,
          );
        }
      }

      const duration = Math.round((Date.now() - startTime) / 1000);
      this.logger.log(`Парсинг OldTimerFarm завершен за ${duration} секунд`);
    } catch (error) {
      this.logger.error(
        `Ошибка при парсинге OldTimerFarm: ${(error as Error).message}`,
      );
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Парсинг RMSothebys: парсит актуальные объявления,
   * обновляет существующие, добавляет новые, помечает отсутствующие в новом парсе как removed.
   */
  async parseRmsothebys(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Парсинг RMSothebys уже выполняется');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      this.logger.log('Начало парсинга RMSothebys');

      // Получаем список всех URL, которые были в базе до парсинга
      const existingUrls = await this.carModel
        .find({
          url: { $regex: /rmsothebys\.com/i },
        })
        .select('url')
        .lean()
        .exec();
      const existingUrlsSet = new Set(
        existingUrls.map((car) => car.url.toLowerCase()),
      );

      // Получаем все ссылки со страницы поиска
      const linksResult = await this.rmsothebysParser.parseAllLinks();
      this.logger.log(`Найдено ссылок для парсинга: ${linksResult.total}`);

      const parsedUrls = new Set<string>();
      let parsedCount = 0;
      let errorCount = 0;

      // Парсим каждое объявление
      for (let i = 0; i < linksResult.links.length; i++) {
        const url = linksResult.links[i];
        this.logger.log(`Парсинг ${i + 1}/${linksResult.links.length}: ${url}`);

        try {
          const car = await this.rmsothebysParser.parseAndSave(url);
          if (car && car.url) {
            parsedUrls.add(car.url.toLowerCase());
            parsedCount++;
          }

          // Небольшая задержка между запросами
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } catch (error) {
          errorCount++;
          this.logger.error(
            `Ошибка при парсинге ${url}: ${(error as Error).message}`,
          );
        }
      }

      this.logger.log(
        `Парсинг завершен: ${parsedCount} обработано, ${errorCount} ошибок`,
      );

      // Находим авто, которые были в базе, но не были найдены при парсинге
      const missingUrls: string[] = [];
      for (const url of existingUrlsSet) {
        if (!parsedUrls.has(url.toLowerCase())) {
          missingUrls.push(url);
        }
      }

      // Помечаем пропавшие авто как removed
      if (missingUrls.length > 0) {
        // Фильтруем только URL с rmsothebys.com
        const rmsothebysUrls = missingUrls.filter((url) =>
          /rmsothebys\.com/i.test(url),
        );

        if (rmsothebysUrls.length > 0) {
          const updateResult = await this.carModel
            .updateMany(
              {
                url: { $in: rmsothebysUrls },
              },
              {
                $set: {
                  status: 'removed',
                  lastChecked: new Date(),
                },
              },
            )
            .exec();

          this.logger.log(
            `Помечено как removed: ${updateResult.modifiedCount} авто с RMSothebys`,
          );
        }
      }

      const duration = Math.round((Date.now() - startTime) / 1000);
      this.logger.log(`Парсинг RMSothebys завершен за ${duration} секунд`);
    } catch (error) {
      this.logger.error(
        `Ошибка при парсинге RMSothebys: ${(error as Error).message}`,
      );
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Полный цикл парсинга: OldTimerFarm, RMSothebys, обновление цен в рублях.
   */
  async runFullParseCycle(): Promise<void> {
    this.logger.log('Запуск полного цикла парсинга');

    try {
      await this.parseOldtimerfarm();
      await this.parseRmsothebys();

      this.logger.log('Запуск обновления цен в рублях');
      const priceResult = await this.carsService.updatePricesInRubles();
      this.logger.log(
        `Обновление цен завершено: обновлено ${priceResult.updated} машин`,
      );

      this.logger.log('Полный цикл парсинга завершен');
    } catch (error) {
      this.logger.error(
        `Ошибка при выполнении полного цикла: ${(error as Error).message}`,
      );
      throw error;
    }
  }
}
