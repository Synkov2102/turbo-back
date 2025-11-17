import {
  Controller,
  Get,
  Query,
  Param,
  NotFoundException,
} from '@nestjs/common';
import { CarsService } from './cars.service';
import { Car } from '../schemas/car.schema';

@Controller('cars')
export class CarsController {
  constructor(private readonly carsService: CarsService) {}

  @Get()
  async getCars(
    @Query('brand') brand?: string,
    @Query('model') model?: string,
    @Query('minYear') minYear?: string,
    @Query('maxYear') maxYear?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
    @Query('city') city?: string,
    @Query('transmission') transmission?: string,
    @Query('minEngineVolume') minEngineVolume?: string,
    @Query('maxEngineVolume') maxEngineVolume?: string,
  ): Promise<Car[]> {
    return await this.carsService.getCarsWithFilters({
      brand,
      model,
      minYear: minYear ? parseInt(minYear) : undefined,
      maxYear: maxYear ? parseInt(maxYear) : undefined,
      minPrice: minPrice ? parseInt(minPrice) : undefined,
      maxPrice: maxPrice ? parseInt(maxPrice) : undefined,
      city,
      transmission,
      minEngineVolume: minEngineVolume
        ? parseFloat(minEngineVolume)
        : undefined,
      maxEngineVolume: maxEngineVolume
        ? parseFloat(maxEngineVolume)
        : undefined,
    });
  }

  @Get(':id')
  async getCarById(@Param('id') id: string): Promise<Car> {
    const car = await this.carsService.getCarById(id);
    if (!car) {
      throw new NotFoundException('Car not found');
    }
    return car;
  }
}
