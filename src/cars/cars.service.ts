import { Injectable, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery } from 'mongoose';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { Car, CarDocument } from '../schemas/car.schema';

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
}

type RangeFilter = { $gte?: number; $lte?: number };

@Injectable()
export class CarsService {
  constructor(
    @InjectModel(Car.name) private carModel: Model<CarDocument>,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async getCarsWithFilters(filters: CarFilters): Promise<Car[]> {
    const cacheKey = `cars:${JSON.stringify(filters)}`;
    const cached = await this.cacheManager.get<Car[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const query: FilterQuery<CarDocument> = {};
    if (filters.brand) query.brand = filters.brand;
    if (filters.model) query.model = filters.model;
    if (filters.minYear || filters.maxYear) {
      const yearFilter: RangeFilter = {};
      if (filters.minYear) yearFilter.$gte = filters.minYear;
      if (filters.maxYear) yearFilter.$lte = filters.maxYear;
      query.year = yearFilter;
    }
    if (filters.minPrice || filters.maxPrice) {
      const priceFilter: RangeFilter = {};
      if (filters.minPrice) priceFilter.$gte = filters.minPrice;
      if (filters.maxPrice) priceFilter.$lte = filters.maxPrice;
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
      query.engineVolume = engineVolumeFilter;
    }

    const cars = await this.carModel.find(query).exec();
    await this.cacheManager.set(cacheKey, cars, 10000); // 1 hour in ms
    return cars;
  }

  async getCarById(id: string): Promise<Car | null> {
    const cacheKey = `car:${id}`;
    const cached = await this.cacheManager.get<Car>(cacheKey);
    if (cached) {
      return cached;
    }

    const car = await this.carModel.findById(id).exec();
    if (car) {
      await this.cacheManager.set(cacheKey, car, 10000); // 1 hour in ms
    }
    return car;
  }
}
