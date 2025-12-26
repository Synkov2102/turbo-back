import { Injectable, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery } from 'mongoose';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { Car, CarDocument } from '../schemas/car.schema';
import { FilterOptions } from './interfaces/filter-options.interface';
import { PaginatedResponse } from './interfaces/paginated-response.interface';

// Интерфейсы
interface CarFilters {
  brand?: string;
  model?: string;
  minYear?: number;
  maxYear?: number;
  minPrice?: number;
  maxPrice?: number;
  city?: string;
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
  constructor(
    @InjectModel(Car.name) private carModel: Model<CarDocument>,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async getCarsWithFilters(
    filters: CarFilters,
  ): Promise<PaginatedResponse<Car>> {
    // Параметры пагинации
    const page = filters.page || 1;
    const limit = filters.limit || 10;
    const skip = (page - 1) * limit;

    // Создаем ключ кэша без параметров пагинации для подсчета общего количества
    const filtersForCache = { ...filters };
    delete filtersForCache.page;
    delete filtersForCache.limit;
    const cacheKey = `cars:${JSON.stringify(filtersForCache)}:page:${page}:limit:${limit}`;
    const countCacheKey = `cars:count:${JSON.stringify(filtersForCache)}`;

    // Проверяем кэш
    const cached =
      await this.cacheManager.get<PaginatedResponse<Car>>(cacheKey);
    if (cached) {
      return cached;
    }

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
      query.price = priceFilter;
    }
    if (filters.city) query.city = filters.city;
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
    const totalQuery = this.getTotalCount(query, countCacheKey);
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

    // Кэшируем результат на 1 час (3600000 мс)
    await this.cacheManager.set(cacheKey, result, 3600000);
    return result;
  }

  private async getTotalCount(
    query: FilterQuery<CarDocument>,
    cacheKey: string,
  ): Promise<number> {
    const cached = await this.cacheManager.get<number>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const total = await this.carModel.countDocuments(query).exec();
    await this.cacheManager.set(cacheKey, total, 3600000); // 1 hour
    return total;
  }

  async getCarById(id: string): Promise<Car | null> {
    const cacheKey = `car:${id}`;
    const cached = await this.cacheManager.get<Car>(cacheKey);
    if (cached) {
      return cached;
    }

    const car = await this.carModel.findById(id).exec();
    if (car) {
      await this.cacheManager.set(cacheKey, car, 3600000); // 1 hour in ms
    }
    return car;
  }

  async getFilterOptions(): Promise<FilterOptions> {
    const cacheKey = 'filter-options';
    const cached = await this.cacheManager.get<FilterOptions>(cacheKey);
    if (cached) {
      return cached;
    }

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
                city: {
                  $exists: true,
                  $nin: [null, ''],
                },
              },
            },
            { $group: { _id: '$city' } },
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
          priceRange: [
            {
              $match: {
                price: {
                  $exists: true,
                  $ne: null,
                },
              },
            },
            {
              $group: {
                _id: null,
                minPrice: { $min: '$price' },
                maxPrice: { $max: '$price' },
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
      priceRange: Array<{ minPrice: number; maxPrice: number }>;
      engineVolumeRange: Array<{
        minEngineVolume: number;
        maxEngineVolume: number;
      }>;
    };

    const yearRange = result.yearRange[0] || { minYear: 0, maxYear: 0 };
    const priceRange = result.priceRange[0] || { minPrice: 0, maxPrice: 0 };
    const engineVolumeRange = result.engineVolumeRange[0] || {
      minEngineVolume: 0,
      maxEngineVolume: 0,
    };

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
      minPrice: priceRange.minPrice,
      maxPrice: priceRange.maxPrice,
      minEngineVolume: engineVolumeRange.minEngineVolume,
      maxEngineVolume: engineVolumeRange.maxEngineVolume,
    };

    await this.cacheManager.set(cacheKey, options, 3600000);
    return options;
  }

  async getModelsByBrand(brand: string): Promise<string[]> {
    if (!brand) {
      return [];
    }

    const cacheKey = `models-${brand}`;
    const cached = await this.cacheManager.get<string[]>(cacheKey);
    if (cached) {
      return cached;
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

    await this.cacheManager.set(cacheKey, filteredModels, 3600000); // Кэш на 1 час
    return filteredModels;
  }
}
