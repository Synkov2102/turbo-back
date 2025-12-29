import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery } from 'mongoose';
import { Car, CarDocument } from '../schemas/car.schema';
import { FilterOptions } from './interfaces/filter-options.interface';
import { PaginatedResponse } from './interfaces/paginated-response.interface';
import { CbrService } from './cbr.service';

// Интерфейсы
interface CarFilters {
  brand?: string;
  model?: string;
  minYear?: number;
  maxYear?: number;
  minPrice?: number;
  maxPrice?: number;
  priceCurrency?: 'RUB' | 'USD' | 'EUR';
  city?: string;
  country?: string;
  transmission?: string;
  minEngineVolume?: number;
  maxEngineVolume?: number;
  page?: number;
  limit?: number;
}

interface RangeFilter {
  $gte?: number;
  $lte?: number;
}

@Injectable()
export class CarsService {
  private readonly logger = new Logger(CarsService.name);

  constructor(
    @InjectModel(Car.name) private carModel: Model<CarDocument>,
    private readonly cbrService: CbrService,
  ) {}

  async getCarsWithFilters(
    filters: CarFilters,
  ): Promise<PaginatedResponse<Car>> {
    // Параметры пагинации
    const page = filters.page || 1;
    const limit = filters.limit || 10;
    const skip = (page - 1) * limit;

    // Кеш отключен для локальной разработки

    // Строим запрос
    const query: FilterQuery<CarDocument> = {};
    // По умолчанию показываем только активные объявления
    query.status = { $ne: 'sold' };
    if (filters.brand) query.brand = filters.brand;
    if (filters.model) query.model = filters.model;
    if (filters.minYear || filters.maxYear) {
      const yearFilter: RangeFilter = {};
      if (filters.minYear) yearFilter.$gte = filters.minYear;
      if (filters.maxYear) yearFilter.$lte = filters.maxYear;
      // Валидация: minYear не должен быть больше maxYear
      if (
        filters.minYear &&
        filters.maxYear &&
        filters.minYear > filters.maxYear
      ) {
        throw new Error('minYear не может быть больше maxYear');
      }
      query.year = yearFilter;
    }
    if (filters.minPrice || filters.maxPrice) {
      const currency = filters.priceCurrency || 'RUB';
      const priceField = `price.${currency}`;
      const priceFilter: RangeFilter = {};
      if (filters.minPrice) priceFilter.$gte = filters.minPrice;
      if (filters.maxPrice) priceFilter.$lte = filters.maxPrice;
      // Валидация: minPrice не должен быть больше maxPrice
      if (
        filters.minPrice &&
        filters.maxPrice &&
        filters.minPrice > filters.maxPrice
      ) {
        throw new Error('minPrice не может быть больше maxPrice');
      }
      query[priceField] = priceFilter;
    }
    if (filters.city || filters.country) {
      query.location = {};
      if (filters.city) query.location.city = filters.city;
      if (filters.country) query.location.country = filters.country;
    }
    if (filters.transmission) query.transmission = filters.transmission;
    if (filters.minEngineVolume || filters.maxEngineVolume) {
      const engineVolumeFilter: RangeFilter = {};
      if (filters.minEngineVolume)
        engineVolumeFilter.$gte = filters.minEngineVolume;
      if (filters.maxEngineVolume)
        engineVolumeFilter.$lte = filters.maxEngineVolume;
      // Валидация: minEngineVolume не должен быть больше maxEngineVolume
      if (
        filters.minEngineVolume &&
        filters.maxEngineVolume &&
        filters.minEngineVolume > filters.maxEngineVolume
      ) {
        throw new Error('minEngineVolume не может быть больше maxEngineVolume');
      }
      query.engineVolume = engineVolumeFilter;
    }

    // Получаем данные и общее количество параллельно
    const carsQuery = this.carModel
      .find(query)
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 }); // Сортировка по дате создания (новые сначала)
    const totalQuery = this.getTotalCount(query);
    const cars = await carsQuery.exec();
    const total = await totalQuery;

    // Вычисляем метаданные
    const totalPages = Math.ceil(total / limit);
    const result: PaginatedResponse<Car> = {
      data: cars,
      meta: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };

    return result;
  }

  private async getTotalCount(
    query: FilterQuery<CarDocument>,
  ): Promise<number> {
    const total = await this.carModel.countDocuments(query).exec();
    return total;
  }

  async getCarById(id: string): Promise<Car | null> {
    const car = await this.carModel.findById(id).exec();
    return car;
  }

  async getFilterOptions(): Promise<FilterOptions> {
    const aggregationResult = await this.carModel.aggregate([
      {
        $facet: {
          // Для строковых полей - уникальные значения
          brands: [
            {
              $match: {
                brand: {
                  $exists: true,
                  $nin: [null, ''],
                },
              },
            },
            { $group: { _id: '$brand' } },
          ],
          cities: [
            {
              $match: {
                'location.city': {
                  $exists: true,
                  $nin: [null, ''],
                },
              },
            },
            { $group: { _id: '$location.city' } },
          ],
          transmissions: [
            {
              $match: {
                transmission: {
                  $exists: true,
                  $nin: [null, ''],
                },
              },
            },
            { $group: { _id: '$transmission' } },
          ],
          models: [
            {
              $match: {
                model: {
                  $exists: true,
                  $nin: [null, ''],
                },
              },
            },
            { $group: { _id: '$model' } },
          ],
          // Для числовых полей - min/max значения
          yearRange: [
            {
              $match: {
                year: {
                  $exists: true,
                  $ne: null,
                },
              },
            },
            {
              $group: {
                _id: null,
                minYear: { $min: '$year' },
                maxYear: { $max: '$year' },
              },
            },
          ],
          priceRangeRUB: [
            {
              $match: {
                'price.RUB': {
                  $exists: true,
                  $ne: null,
                },
              },
            },
            {
              $group: {
                _id: null,
                minPrice: { $min: '$price.RUB' },
                maxPrice: { $max: '$price.RUB' },
              },
            },
          ],
          priceRangeUSD: [
            {
              $match: {
                'price.USD': {
                  $exists: true,
                  $ne: null,
                },
              },
            },
            {
              $group: {
                _id: null,
                minPrice: { $min: '$price.USD' },
                maxPrice: { $max: '$price.USD' },
              },
            },
          ],
          priceRangeEUR: [
            {
              $match: {
                'price.EUR': {
                  $exists: true,
                  $ne: null,
                },
              },
            },
            {
              $group: {
                _id: null,
                minPrice: { $min: '$price.EUR' },
                maxPrice: { $max: '$price.EUR' },
              },
            },
          ],
          engineVolumeRange: [
            {
              $match: {
                engineVolume: {
                  $exists: true,
                  $ne: null,
                },
              },
            },
            {
              $group: {
                _id: null,
                minEngineVolume: { $min: '$engineVolume' },
                maxEngineVolume: { $max: '$engineVolume' },
              },
            },
          ],
        },
      },
    ]);

    const result = aggregationResult[0] as {
      brands: Array<{ _id: string }>;
      cities: Array<{ _id: string }>;
      transmissions: Array<{ _id: string }>;
      models: Array<{ _id: string }>;
      yearRange: Array<{ minYear: number; maxYear: number }>;
      priceRangeRUB: Array<{ minPrice: number; maxPrice: number }>;
      priceRangeUSD: Array<{ minPrice: number; maxPrice: number }>;
      priceRangeEUR: Array<{ minPrice: number; maxPrice: number }>;
      engineVolumeRange: Array<{
        minEngineVolume: number;
        maxEngineVolume: number;
      }>;
    };

    const yearRange = result.yearRange[0] || { minYear: 0, maxYear: 0 };
    const priceRangeRUB = result.priceRangeRUB[0] || { minPrice: 0, maxPrice: 0 };
    const priceRangeUSD = result.priceRangeUSD[0] || { minPrice: 0, maxPrice: 0 };
    const priceRangeEUR = result.priceRangeEUR[0] || { minPrice: 0, maxPrice: 0 };
    const engineVolumeRange = result.engineVolumeRange[0] || {
      minEngineVolume: 0,
      maxEngineVolume: 0,
    };

    // Берем максимальный диапазон из всех валют для обратной совместимости
    const minPrice = Math.min(
      priceRangeRUB.minPrice || Infinity,
      priceRangeUSD.minPrice || Infinity,
      priceRangeEUR.minPrice || Infinity,
    );
    const maxPrice = Math.max(
      priceRangeRUB.maxPrice || 0,
      priceRangeUSD.maxPrice || 0,
      priceRangeEUR.maxPrice || 0,
    );

    const options: FilterOptions = {
      brands: result.brands
        .map((b) => b._id)
        .filter(Boolean)
        .sort(),
      cities: result.cities
        .map((c) => c._id)
        .filter(Boolean)
        .sort(),
      transmissions: result.transmissions
        .map((t) => t._id)
        .filter(Boolean)
        .sort(),
      models: result.models
        .map((m) => m._id)
        .filter(Boolean)
        .sort(),
      minYear: yearRange.minYear,
      maxYear: yearRange.maxYear,
      minPrice: isFinite(minPrice) ? minPrice : 0,
      maxPrice: maxPrice,
      minEngineVolume: engineVolumeRange.minEngineVolume,
      maxEngineVolume: engineVolumeRange.maxEngineVolume,
    };

    return options;
  }

  async getModelsByBrand(brand: string): Promise<string[]> {
    if (!brand) {
      return [];
    }

    // Получаем уникальные модели для указанного бренда
    const models = await this.carModel
      .distinct('model', {
        brand,
        model: {
          $exists: true,
          $nin: [null, ''],
        },
      })
      .exec();

    // Фильтруем и сортируем результаты
    const filteredModels = models
      .filter((model) => model && model.trim().length > 0)
      .sort();

    return filteredModels;
  }

  /**
   * Обновляет цены в рублях для всех машин, у которых есть цена в валюте
   * Использует актуальные курсы валют с сайта ЦБ РФ
   */
  async updatePricesInRubles(): Promise<{
    updated: number;
    usdUpdated: number;
    eurUpdated: number;
    errors: number;
  }> {
    this.logger.log('Начало обновления цен в рублях...');

    try {
      // Получаем актуальные курсы валют
      const rates = await this.cbrService.getExchangeRates();
      this.logger.log(
        `Получены курсы валют: USD = ${rates.USD}, EUR = ${rates.EUR}`,
      );

      let updated = 0;
      let usdUpdated = 0;
      let eurUpdated = 0;
      let errors = 0;

      // Находим все машины, у которых есть цена в USD или EUR
      const carsWithCurrency = await this.carModel
        .find({
          $or: [
            { 'price.USD': { $exists: true, $ne: null, $gt: 0 } },
            { 'price.EUR': { $exists: true, $ne: null, $gt: 0 } },
          ],
        })
        .exec();

      this.logger.log(
        `Найдено машин с ценами в валюте: ${carsWithCurrency.length}`,
      );

      // Обновляем каждую машину
      for (const car of carsWithCurrency) {
        try {
          let rubPriceFromUsd = 0;
          let rubPriceFromEur = 0;

          // Если есть цена в USD, пересчитываем в рубли
          if (car.price?.USD && car.price.USD > 0) {
            rubPriceFromUsd = Math.round(car.price.USD * rates.USD);
            usdUpdated++;
            this.logger.debug(
              `Машина ${car._id}: USD ${car.price.USD} -> RUB ${rubPriceFromUsd}`,
            );
          }

          // Если есть цена в EUR, пересчитываем в рубли
          if (car.price?.EUR && car.price.EUR > 0) {
            rubPriceFromEur = Math.round(car.price.EUR * rates.EUR);
            eurUpdated++;
            this.logger.debug(
              `Машина ${car._id}: EUR ${car.price.EUR} -> RUB ${rubPriceFromEur}`,
            );
          }

          // Берем максимальную цену в рублях из доступных валют
          const finalRubPrice = Math.max(rubPriceFromUsd, rubPriceFromEur);

          if (finalRubPrice > 0) {
            await this.carModel.updateOne(
              { _id: car._id },
              { $set: { 'price.RUB': finalRubPrice } },
            );
            updated++;
          }
        } catch (error) {
          errors++;
          this.logger.error(
            `Ошибка при обновлении машины ${car._id}: ${(error as Error).message}`,
          );
        }
      }

      this.logger.log(
        `Обновление завершено: обновлено ${updated} машин (USD: ${usdUpdated}, EUR: ${eurUpdated}), ошибок: ${errors}`,
      );

      return {
        updated,
        usdUpdated,
        eurUpdated,
        errors,
      };
    } catch (error) {
      this.logger.error(
        `Ошибка при обновлении цен: ${(error as Error).message}`,
      );
      throw error;
    }
  }
}
