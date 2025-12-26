import { ApiProperty } from '@nestjs/swagger';
import { Car } from '../../schemas/car.schema';

export class StatusCheckStatsDto {
  @ApiProperty({
    description: 'Общее количество проверенных объявлений',
    example: 50,
  })
  total: number;

  @ApiProperty({
    description: 'Количество объявлений со статусом active',
    example: 45,
  })
  active: number;

  @ApiProperty({
    description: 'Количество проданных объявлений',
    example: 3,
  })
  sold: number;

  @ApiProperty({
    description: 'Количество удаленных объявлений',
    example: 2,
  })
  removed: number;

  @ApiProperty({
    description: 'Количество объявлений с неизвестным статусом',
    example: 0,
  })
  unknown: number;

  @ApiProperty({
    description: 'Количество объявлений, у которых изменился статус',
    example: 5,
  })
  statusChanged: number;
}

export class StatusCheckResultDto {
  @ApiProperty({
    description: 'Список проверенных автомобилей',
    type: [Car],
  })
  checked: Car[];

  @ApiProperty({
    description: 'Статистика проверки',
    type: StatusCheckStatsDto,
  })
  stats: StatusCheckStatsDto;

  @ApiProperty({
    description: 'Список автомобилей, у которых изменился статус',
    type: [Car],
  })
  changed: Car[];
}
