import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUrl } from 'class-validator';

export class ParseAvitoDto {
  @ApiProperty({
    description: 'URL объявления на Avito или Auto.ru',
    example:
      'https://www.avito.ru/moskva/avtomobili/toyota_camry_2020_1234567890',
  })
  @IsString()
  @IsUrl({}, { message: 'URL должен быть валидным' })
  url: string;
}
