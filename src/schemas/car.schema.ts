import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export type CarDocument = Car & Document;

@Schema()
export class Car {
  @ApiProperty({
    description: 'Название объявления',
    example: 'Toyota Camry 2020',
  })
  @Prop({ required: true })
  title: string;

  @ApiProperty({
    description: 'Бренд автомобиля',
    example: 'Toyota',
    required: false,
  })
  @Prop()
  brand: string;

  @ApiProperty({
    description: 'Модель автомобиля',
    example: 'Camry',
    required: false,
  })
  @Prop()
  model: string;

  @ApiProperty({ description: 'Год выпуска', example: 2020, required: false })
  @Prop()
  year: number;

  @ApiProperty({
    description: 'Цена в рублях',
    example: 1500000,
    required: false,
  })
  @Prop()
  price: number;

  @ApiProperty({
    description: 'Пробег в километрах',
    example: 50000,
    required: false,
  })
  @Prop()
  mileage: number;

  @ApiProperty({ description: 'Город', example: 'Москва', required: false })
  @Prop()
  city: string;

  @ApiProperty({
    description: 'Тип трансмиссии',
    example: 'AT',
    enum: ['AT', 'MT', 'AMT', 'CVT'],
    required: false,
  })
  @Prop()
  transmission: string;

  @ApiProperty({
    description: 'Объем двигателя в литрах',
    example: 2.5,
    required: false,
  })
  @Prop()
  engineVolume: number;

  @ApiProperty({ description: 'Описание автомобиля', required: false })
  @Prop()
  description: string;

  @ApiProperty({
    description: 'URL объявления на Avito',
    example: 'https://www.avito.ru/...',
  })
  @Prop({ required: true })
  url: string;

  @ApiProperty({
    description: 'Массив URL изображений',
    type: [String],
    required: false,
  })
  @Prop({ type: [String] })
  images: string[];

  @ApiProperty({
    description: 'Дата создания записи',
    example: '2024-01-01T00:00:00.000Z',
  })
  @Prop({ default: Date.now })
  createdAt: Date;
}

export const CarSchema = SchemaFactory.createForClass(Car);

// Индексы для оптимизации запросов
CarSchema.index({ brand: 1 });
CarSchema.index({ model: 1 });
CarSchema.index({ year: 1 });
CarSchema.index({ price: 1 });
CarSchema.index({ city: 1 });
CarSchema.index({ transmission: 1 });
CarSchema.index({ url: 1 }, { unique: true }); // Уникальный индекс для предотвращения дубликатов
CarSchema.index({ createdAt: -1 }); // Для сортировки по дате

// Составные индексы для частых запросов
CarSchema.index({ brand: 1, model: 1 });
CarSchema.index({ brand: 1, year: 1 });
CarSchema.index({ city: 1, brand: 1 });

// Disable version key to remove __v from documents
CarSchema.set('versionKey', false);

// Remove __v from JSON output
CarSchema.set('toJSON', {
  transform: (doc, ret) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { __v, ...rest } = ret;
    return rest;
  },
});
