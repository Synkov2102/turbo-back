import { ApiProperty } from '@nestjs/swagger';
import { Car } from '../../schemas/car.schema';

export class ParseAllResultDto {
  @ApiProperty({
    description: 'Общее количество найденных объявлений',
    example: 150,
  })
  total: number;

  @ApiProperty({
    description: 'Количество успешно распарсенных автомобилей',
    example: 120,
  })
  parsed: number;

  @ApiProperty({
    description: 'Количество пропущенных объявлений (мотоциклы и т.д.)',
    example: 20,
  })
  skipped: number;

  @ApiProperty({
    description: 'Количество ошибок при парсинге',
    example: 10,
  })
  errors: number;

  @ApiProperty({
    description: 'Список распарсенных автомобилей',
    type: [Car],
  })
  cars: Car[];

  @ApiProperty({
    description: 'Список ошибок с URL объявлений',
    type: 'array',
    items: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        error: { type: 'string' },
      },
    },
    example: [
      { url: 'https://example.com/car1', error: 'Failed to parse' },
    ],
  })
  errorsList: Array<{ url: string; error: string }>;
}





