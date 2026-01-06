import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { PostsService } from './posts.service';
import { CreatePostDto } from './dto/create-post.dto';
import { PostsQueryDto } from './dto/posts-query.dto';
import { PaginatedPostsResponseDto } from './dto/paginated-posts-response.dto';
import { Post as PostSchema } from '../schemas/post.schema';

@ApiTags('posts')
@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Post()
  @ApiOperation({
    summary: 'Создать новый пост',
    description:
      'Создает новый пост с заголовком, текстом, фотографиями и опциональной ссылкой',
  })
  @ApiResponse({
    status: 201,
    description: 'Пост успешно создан',
    type: PostSchema,
  })
  async createPost(@Body() createPostDto: CreatePostDto): Promise<PostSchema> {
    return await this.postsService.createPost(createPostDto);
  }

  @Get()
  @ApiOperation({
    summary: 'Получить список постов с пагинацией',
    description: 'Возвращает список постов с метаданными пагинации',
  })
  @ApiResponse({
    status: 200,
    description: 'Список постов с метаданными пагинации',
    type: PaginatedPostsResponseDto,
  })
  async getPosts(
    @Query() query: PostsQueryDto,
  ): Promise<PaginatedPostsResponseDto> {
    const page = query.page || 1;
    const limit = query.limit || 10;
    return await this.postsService.getPosts(page, limit);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Получить детальную информацию о посте',
    description: 'Возвращает полную информацию о посте по его ID',
  })
  @ApiParam({
    name: 'id',
    description: 'ID поста',
    example: '507f1f77bcf86cd799439011',
  })
  @ApiResponse({
    status: 200,
    description: 'Детальная информация о посте',
    type: PostSchema,
  })
  @ApiResponse({
    status: 404,
    description: 'Пост не найден',
  })
  async getPostById(@Param('id') id: string): Promise<PostSchema> {
    const post = await this.postsService.getPostById(id);
    if (!post) {
      throw new NotFoundException(`Пост с ID ${id} не найден`);
    }
    return post;
  }
}
