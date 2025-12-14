import { IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ModelsQueryDto {
  @ApiProperty({
    description: 'Бренд автомобиля',
    example: 'Toyota',
    required: false,
  })
  @IsOptional()
  @IsString()
  brand?: string;
}
