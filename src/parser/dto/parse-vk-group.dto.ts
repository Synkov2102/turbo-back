import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  Min,
  Max,
} from 'class-validator';

export class ParseVkGroupDto {
  @ApiProperty({
    description: 'ID группы ВК или короткое имя (screen_name)',
    example: 'club123456 или auto_sales',
  })
  @IsString()
  @IsNotEmpty()
  groupId: string;

  @ApiProperty({
    description: 'Количество постов для парсинга (максимум 100)',
    example: 20,
    required: false,
    default: 20,
  })
  @IsNumber()
  @Min(1)
  @Max(100)
  @IsOptional()
  count?: number;

  @ApiProperty({
    description: 'Смещение для пагинации',
    example: 0,
    required: false,
    default: 0,
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  offset?: number;
}
