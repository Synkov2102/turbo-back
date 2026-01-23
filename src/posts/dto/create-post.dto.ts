import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsArray, IsUrl } from 'class-validator';

export class CreatePostDto {
  @ApiProperty({
    description: 'Заголовок поста',
    example: 'Новый автомобиль в продаже',
  })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({
    description: 'Текст поста',
    example: 'Подробное описание автомобиля...',
  })
  @IsString()
  @IsNotEmpty()
  text: string;

  @ApiProperty({
    description: 'Массив ссылок на фотографии',
    type: [String],
    example: ['https://example.com/photo1.jpg', 'https://example.com/photo2.jpg'],
    required: false,
  })
  @IsArray()
  @IsUrl({}, { each: true })
  @IsOptional()
  images?: string[];

  @ApiProperty({
    description: 'Ссылка на пост (опционально)',
    example: 'https://example.com/post/123',
    required: false,
  })
  @IsString()
  @IsUrl()
  @IsOptional()
  url?: string;
}







