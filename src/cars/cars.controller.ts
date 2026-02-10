import {
  Controller,
  Get,
  Post,
  Query,
  Param,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { CarsService } from './cars.service';
import { Car } from '../schemas/car.schema';
import { ModelsQueryDto } from './dto/models-query.dto';
import { CarsFilterDto } from './dto/cars-filter.dto';
import { FilterOptions } from './interfaces/filter-options.interface';
import { PaginatedResponse } from './interfaces/paginated-response.interface';
import { PaginatedResponseDto } from './dto/paginated-response.dto';
import { FilterOptionsDto } from './dto/filter-options.dto';
import {
  BrandStatsResponseDto,
  BrandStatDto,
} from './dto/brand-stats.dto';

@ApiTags('cars')
@Controller('cars')
export class CarsController {
  constructor(private readonly carsService: CarsService) {}

  @Get()
  @ApiOperation({
    summary: 'Получить список автомобилей с фильтрами и пагинацией',
  })
  @ApiResponse({
    status: 200,
    description: 'Список автомобилей с метаданными пагинации',
    type: PaginatedResponseDto,
  })
  async getCars(
    @Query() query: CarsFilterDto,
  ): Promise<PaginatedResponse<Car>> {
    return await this.carsService.getCarsWithFilters({
      brand: query.brand,
      model: query.model,
      minYear: query.minYear,
      maxYear: query.maxYear,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
      priceCurrency: query.priceCurrency,
      city: query.city,
      country: query.country,
      transmission: query.transmission,
      minEngineVolume: query.minEngineVolume,
      maxEngineVolume: query.maxEngineVolume,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get('filters/options')
  @ApiOperation({ summary: 'Получить опции для фильтров' })
  @ApiResponse({
    status: 200,
    description: 'Опции для фильтров (бренды, города, диапазоны цен и т.д.)',
    type: FilterOptionsDto,
  })
  async getFilterOptions(): Promise<FilterOptions> {
    return this.carsService.getFilterOptions();
  }

  @Get('filters/models')
  @ApiOperation({ summary: 'Получить список моделей по бренду' })
  @ApiResponse({
    status: 200,
    description: 'Список моделей для указанного бренда',
    type: [String],
  })
  async getModelsByBrand(@Query() query: ModelsQueryDto): Promise<string[]> {
    if (!query.brand) {
      return [];
    }
    return this.carsService.getModelsByBrand(query.brand);
  }

  @Get('stats/brands')
  @ApiOperation({
    summary: 'Получить статистику по брендам',
    description:
      'Возвращает список всех брендов с количеством автомобилей по каждому бренду. Отсортировано по убыванию количества.',
  })
  @ApiResponse({
    status: 200,
    description: 'Статистика по брендам',
    type: BrandStatsResponseDto,
  })
  async getBrandStats(): Promise<BrandStatsResponseDto> {
    const brands = await this.carsService.getBrandStats();
    const total = brands.reduce((sum, item) => sum + item.count, 0);

    return {
      brands,
      total,
    };
  }

  @Post('prices/update-rubles')
  @ApiOperation({
    summary: 'Обновить цены в рублях по актуальным курсам валют',
    description:
      'Запрашивает актуальные курсы валют с сайта ЦБ РФ и обновляет цены в рублях для всех машин, у которых есть цена в USD или EUR',
  })
  @ApiResponse({
    status: 200,
    description: 'Результат обновления цен',
    schema: {
      type: 'object',
      properties: {
        updated: {
          type: 'number',
          description: 'Количество обновленных машин',
        },
        usdUpdated: {
          type: 'number',
          description: 'Количество машин с ценой в USD',
        },
        eurUpdated: {
          type: 'number',
          description: 'Количество машин с ценой в EUR',
        },
        errors: {
          type: 'number',
          description: 'Количество ошибок при обновлении',
        },
      },
    },
  })
  async updatePricesInRubles(): Promise<{
    updated: number;
    usdUpdated: number;
    eurUpdated: number;
    errors: number;
  }> {
    return await this.carsService.updatePricesInRubles();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получить автомобиль по ID' })
  @ApiParam({
    name: 'id',
    description: 'ID автомобиля',
    example: '507f1f77bcf86cd799439011',
  })
  @ApiResponse({
    status: 200,
    description: 'Информация об автомобиле',
    type: Car,
  })
  @ApiResponse({
    status: 404,
    description: 'Автомобиль не найден',
  })
  async getCarById(@Param('id') id: string): Promise<Car> {
    const car = await this.carsService.getCarById(id);
    if (!car) {
      throw new NotFoundException('Car not found');
    }
    return car;
  }
}
