import { ApiProperty } from '@nestjs/swagger';

export class BrandStatDto {
  @ApiProperty({
    description: 'Название бренда',
    example: 'Toyota',
  })
  brand: string;

  @ApiProperty({
    description: 'Количество автомобилей данного бренда',
    example: 42,
  })
  count: number;
}

export class BrandStatsResponseDto {
  @ApiProperty({
    description: 'Массив статистики по брендам',
    type: [BrandStatDto],
  })
  brands: BrandStatDto[];

  @ApiProperty({
    description: 'Общее количество автомобилей',
    example: 150,
  })
  total: number;
}
