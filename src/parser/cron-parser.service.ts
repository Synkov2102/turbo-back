import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery } from 'mongoose';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { Car, CarDocument } from '../schemas/car.schema';
import {
  CRON_OLDTIMERFARM,
  CRON_RMSOTHEBYS,
  CRON_UPDATE_PRICES_RUB,
  CRON_VK_GROUPS,
} from '../constants/cron.constants';
import { OldtimerfarmParserService } from './oldtimerfarm-parser.service';
import { RmsothebysParserService } from './rmsothebys-parser.service';
import { VkParserService } from './vk-parser.service';
import { CarsService } from '../cars/cars.service';
import { StatusCheckerService } from './status-checker.service';

@Injectable()
export class CronParserService {
  private readonly logger = new Logger(CronParserService.name);
  private isRunning = false;

  constructor(
    @InjectModel(Car.name) private carModel: Model<CarDocument>,
    private readonly oldtimerfarmParser: OldtimerfarmParserService,
    private readonly rmsothebysParser: RmsothebysParserService,
    private readonly vkParserService: VkParserService,
    private readonly carsService: CarsService,
    private readonly statusCheckerService: StatusCheckerService,
    private readonly configService: ConfigService,
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
   * Cron job для парсинга постов из групп ВКонтакте
   */
  @Cron(CRON_VK_GROUPS)
  async parseVkGroupsCron() {
    this.logger.log('Запуск cron job для парсинга групп ВКонтакте');
    try {
      await this.parseVkGroups();
    } catch (error) {
      this.logger.error(
        `Ошибка при парсинге групп ВК: ${(error as Error).message}`,
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
   * Проверка статуса объявлений Auto.ru: проверяет все активные и unknown объявления.
   */
  async checkAutoRuCars(): Promise<void> {
    this.logger.log('Начало проверки объявлений Auto.ru');

    try {
      // Находим объявления Auto.ru со статусом active или unknown
      const query: FilterQuery<CarDocument> = {
        url: { $regex: /auto\.ru/i },
        $or: [
          { status: 'active' },
          { status: 'unknown' },
          { status: { $exists: false } },
        ],
      };

      const cars = await this.carModel.find(query).limit(50).exec();

      this.logger.log(
        `Найдено объявлений Auto.ru для проверки: ${cars.length}`,
      );

      if (cars.length === 0) {
        this.logger.log('Нет объявлений Auto.ru для проверки');
        return;
      }

      let checked = 0;
      let changed = 0;

      for (let i = 0; i < cars.length; i++) {
        const car = cars[i];
        try {
          const carId = car._id?.toString() || 'unknown';
          this.logger.log(
            `Проверка ${i + 1}/${cars.length}: ${carId} - ${car.title}`,
          );

          const oldStatus = car.status || 'unknown';
          const newStatus = await this.statusCheckerService.checkStatus(
            car.url,
          );
          const statusChanged = oldStatus !== newStatus;

          car.status = newStatus;
          car.lastChecked = new Date();
          await car.save();

          checked++;
          if (statusChanged) {
            changed++;
            this.logger.log(
              `Статус изменен: ${oldStatus} -> ${newStatus} для ${String(carId)}`,
            );
          }

          // Задержка между проверками
          if (i < cars.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 3000));
          }
        } catch (error) {
          const errorCarId: string = car._id?.toString() || 'unknown';
          this.logger.error(
            `Ошибка при проверке ${errorCarId}: ${(error as Error).message}`,
          );
        }
      }

      this.logger.log(
        `Проверка Auto.ru завершена: проверено ${checked}, изменено ${changed}`,
      );
    } catch (error) {
      this.logger.error(
        `Ошибка при проверке Auto.ru: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /**
   * Парсинг постов из групп ВКонтакте
   * Читает список групп из переменной окружения VK_GROUPS_TO_PARSE
   * Формат: группы через запятую, например: "turbo_journal_vk,club123456"
   */
  async parseVkGroups(): Promise<void> {
    const groupsToParse = this.configService.get<string>('VK_GROUPS_TO_PARSE');

    if (!groupsToParse || groupsToParse.trim().length === 0) {
      this.logger.warn(
        'VK_GROUPS_TO_PARSE не установлен. Парсинг групп ВК пропущен.',
      );
      return;
    }

    const groups = this.parseGroupsList(groupsToParse);
    if (groups.length === 0) {
      this.logger.warn('Список групп ВК пуст. Парсинг пропущен.');
      return;
    }

    this.logger.log(
      `Начало парсинга ${groups.length} групп ВК: ${groups.join(', ')}`,
    );

    const defaultPostCount = 20;
    const delayBetweenGroups = 2000; // 2 секунды между группами для соблюдения лимитов API

    for (let i = 0; i < groups.length; i++) {
      const groupId = groups[i];

      try {
        await this.parseSingleVkGroup(
          groupId,
          i + 1,
          groups.length,
          defaultPostCount,
        );

        // Задержка между группами (кроме последней)
        if (i < groups.length - 1) {
          await new Promise((resolve) =>
            setTimeout(resolve, delayBetweenGroups),
          );
        }
      } catch (error) {
        this.logger.error(
          `Ошибка при парсинге группы ${groupId}: ${(error as Error).message}`,
        );
        // Продолжаем парсинг других групп даже при ошибке
      }
    }

    this.logger.log('Парсинг всех групп ВК завершен');
  }

  /**
   * Парсит одну группу ВК
   * @param groupId - ID группы или короткое имя
   * @param currentIndex - Текущий индекс группы (для логов)
   * @param totalGroups - Общее количество групп (для логов)
   * @param postCount - Количество постов для парсинга
   */
  private async parseSingleVkGroup(
    groupId: string,
    currentIndex: number,
    totalGroups: number,
    postCount: number,
  ): Promise<void> {
    this.logger.log(
      `Парсинг группы ${currentIndex}/${totalGroups}: ${groupId}`,
    );

    const result = await this.vkParserService.parseAndSavePosts({
      groupId,
      count: postCount,
      offset: 0,
    });

    this.logger.log(
      `Группа ${groupId}: получено ${result.parsed}, сохранено ${result.saved}, пропущено ${result.skipped}, ошибок ${result.errors}`,
    );
  }

  /**
   * Парсит строку со списком групп ВК
   * @param groupsString - Строка с группами через запятую
   * @returns Массив ID групп
   */
  private parseGroupsList(groupsString: string): string[] {
    return groupsString
      .split(',')
      .map((g) => g.trim())
      .filter((g) => g.length > 0);
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
