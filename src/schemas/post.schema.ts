import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export type PostDocument = Post & Document;

@Schema()
export class Post {
  @ApiProperty({
    description: 'Заголовок поста',
    example: 'Новый автомобиль в продаже',
  })
  @Prop({ required: true })
  title: string;

  @ApiProperty({
    description: 'Текст поста',
    example: 'Подробное описание автомобиля...',
  })
  @Prop({ required: true })
  text: string;

  @ApiProperty({
    description: 'Массив ссылок на фотографии',
    type: [String],
    example: ['https://example.com/photo1.jpg', 'https://example.com/photo2.jpg'],
    required: false,
  })
  @Prop({ type: [String], default: [] })
  images: string[];

  @ApiProperty({
    description: 'Ссылка на пост (опционально)',
    example: 'https://example.com/post/123',
    required: false,
  })
  @Prop()
  url?: string;

  @ApiProperty({
    description: 'Дата создания записи',
    example: '2024-01-01T00:00:00.000Z',
  })
  @Prop({ default: Date.now })
  createdAt: Date;
}

export const PostSchema = SchemaFactory.createForClass(Post);

// Индексы для оптимизации запросов
PostSchema.index({ createdAt: -1 }); // Для сортировки по дате (новые сначала)

// Disable version key to remove __v from documents
PostSchema.set('versionKey', false);

// Remove __v from JSON output
PostSchema.set('toJSON', {
  transform: (doc, ret) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { __v, ...rest } = ret;
    return rest;
  },
});



