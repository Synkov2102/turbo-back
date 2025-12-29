import { IsOptional, IsString, IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CarsFilterDto {
  @ApiProperty({
    description: 'Бренд автомобиля',
    example: 'Toyota',
    required: false,
  })
  @IsOptional()
  @IsString()
  brand?: string;

  @ApiProperty({
    description: 'Модель автомобиля',
    example: 'Camry',
    required: false,
  })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiProperty({
    description: 'Минимальный год выпуска',
    example: 2010,
    minimum: 1900,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1900)
  minYear?: number;

  @ApiProperty({
    description: 'Максимальный год выпуска',
    example: 2024,
    maximum: 2030,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Max(2030)
  maxYear?: number;

  @ApiProperty({
    description: 'Минимальная цена',
    example: 500000,
    minimum: 0,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @ApiProperty({
    description: 'Максимальная цена',
    example: 5000000,
    minimum: 0,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @ApiProperty({
    description: 'Валюта для фильтрации по цене',
    example: 'RUB',
    enum: ['RUB', 'USD', 'EUR'],
    required: false,
    default: 'RUB',
  })
  @IsOptional()
  @IsString()
  priceCurrency?: 'RUB' | 'USD' | 'EUR';

  @ApiProperty({ description: 'Город', example: 'Москва', required: false })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiProperty({
    description: 'Страна',
    example: 'Россия',
    required: false,
  })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiProperty({
    description: 'Тип трансмиссии',
    example: 'AT',
    enum: ['AT', 'MT', 'AMT', 'CVT'],
    required: false,
  })
  @IsOptional()
  @IsString()
  transmission?: string;

  @ApiProperty({
    description: 'Минимальный объем двигателя в литрах',
    example: 1.5,
    minimum: 0,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minEngineVolume?: number;

  @ApiProperty({
    description: 'Максимальный объем двигателя в литрах',
    example: 5.0,
    minimum: 0,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxEngineVolume?: number;

  @ApiProperty({
    description: 'Номер страницы',
    example: 1,
    minimum: 1,
    default: 1,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiProperty({
    description: 'Количество элементов на странице',
    example: 10,
    minimum: 1,
    maximum: 100,
    default: 10,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number;
}
