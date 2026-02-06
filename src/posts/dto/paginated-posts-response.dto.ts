import { ApiProperty } from '@nestjs/swagger';
import { Post } from '../../schemas/post.schema';

export class PaginationMetaDto {
  @ApiProperty({ description: 'Текущая страница', example: 1 })
  page: number;

  @ApiProperty({ description: 'Количество элементов на странице', example: 10 })
  limit: number;

  @ApiProperty({ description: 'Общее количество элементов', example: 150 })
  total: number;

  @ApiProperty({ description: 'Общее количество страниц', example: 15 })
  totalPages: number;

  @ApiProperty({ description: 'Есть ли следующая страница', example: true })
  hasNext: boolean;

  @ApiProperty({ description: 'Есть ли предыдущая страница', example: false })
  hasPrev: boolean;
}

export class PaginatedPostsResponseDto {
  @ApiProperty({ description: 'Массив постов', type: [Post] })
  data: Post[];

  @ApiProperty({ description: 'Метаданные пагинации', type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
