import { ApiProperty } from '@nestjs/swagger';

export class FilterOptionsDto {
  @ApiProperty({
    description: 'Список уникальных брендов',
    type: [String],
    example: ['Toyota', 'BMW', 'Mercedes'],
  })
  brands: string[];

  @ApiProperty({
    description: 'Список уникальных городов',
    type: [String],
    example: ['Москва', 'Санкт-Петербург'],
  })
  cities: string[];

  @ApiProperty({
    description: 'Список уникальных типов трансмиссий',
    type: [String],
    example: ['AT', 'MT'],
  })
  transmissions: string[];

  @ApiProperty({
    description: 'Список уникальных моделей (всех брендов)',
    type: [String],
    example: ['Camry', 'Corolla'],
  })
  models: string[];

  @ApiProperty({
    description: 'Минимальный год выпуска среди всех автомобилей',
    example: 1990,
  })
  minYear: number;

  @ApiProperty({
    description: 'Максимальный год выпуска среди всех автомобилей',
    example: 2024,
  })
  maxYear: number;

  @ApiProperty({
    description: 'Минимальная цена среди всех автомобилей',
    example: 100000,
  })
  minPrice: number;

  @ApiProperty({
    description: 'Максимальная цена среди всех автомобилей',
    example: 10000000,
  })
  maxPrice: number;

  @ApiProperty({
    description: 'Минимальный объем двигателя среди всех автомобилей',
    example: 1.0,
  })
  minEngineVolume: number;

  @ApiProperty({
    description: 'Максимальный объем двигателя среди всех автомобилей',
    example: 6.0,
  })
  maxEngineVolume: number;
}
