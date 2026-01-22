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
    description: 'Цена в разных валютах',
    example: { RUB: 1500000, USD: 16000, EUR: 15000, GBP: 12000 },
    required: false,
  })
  @Prop({
    type: {
      RUB: { type: Number, required: false },
      USD: { type: Number, required: false },
      EUR: { type: Number, required: false },
      GBP: { type: Number, required: false },
    },
    _id: false,
  })
  price: {
    RUB?: number;
    USD?: number;
    EUR?: number;
    GBP?: number;
  };

  @ApiProperty({
    description: 'Пробег в километрах',
    example: 50000,
    required: false,
  })
  @Prop()
  mileage: number;

  @ApiProperty({
    description: 'Локация автомобиля',
    example: { city: 'Москва', country: 'Россия' },
    required: false,
  })
  @Prop({
    type: {
      city: { type: String, required: false },
      country: { type: String, required: false },
    },
    _id: false,
  })
  location: {
    city?: string;
    country?: string;
  };

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

  @ApiProperty({
    description: 'Статус объявления',
    example: 'active',
    enum: ['active', 'sold', 'removed', 'unknown'],
    required: false,
  })
  @Prop({ enum: ['active', 'sold', 'removed', 'unknown'], default: 'active' })
  status: string;

  @ApiProperty({
    description: 'Дата последней проверки статуса',
    example: '2024-01-01T00:00:00.000Z',
    required: false,
  })
  @Prop()
  lastChecked: Date;

  @ApiProperty({
    description: 'Тип объявления: аукцион или простое объявление',
    example: 'auction',
    enum: ['auction', 'listing'],
    required: false,
  })
  @Prop({ enum: ['auction', 'listing'] })
  listingType?: string;

  @ApiProperty({
    description: 'Дата аукциона (только для аукционов)',
    example: '2024-03-15T00:00:00.000Z',
    required: false,
  })
  @Prop()
  auctionDate?: Date;

  @ApiProperty({
    description: 'Начальная цена (цена от) для аукционов',
    example: { USD: 100000, EUR: 90000, GBP: 80000 },
    required: false,
  })
  @Prop({
    type: {
      RUB: { type: Number, required: false },
      USD: { type: Number, required: false },
      EUR: { type: Number, required: false },
      GBP: { type: Number, required: false },
    },
    _id: false,
  })
  startingPrice?: {
    RUB?: number;
    USD?: number;
    EUR?: number;
    GBP?: number;
  };
}

export const CarSchema = SchemaFactory.createForClass(Car);

// Индексы для оптимизации запросов
CarSchema.index({ brand: 1 });
CarSchema.index({ model: 1 });
CarSchema.index({ year: 1 });
CarSchema.index({ 'price.RUB': 1 });
CarSchema.index({ 'price.USD': 1 });
CarSchema.index({ 'price.EUR': 1 });
CarSchema.index({ 'price.GBP': 1 });
CarSchema.index({ 'location.city': 1 });
CarSchema.index({ 'location.country': 1 });
CarSchema.index({ transmission: 1 });
CarSchema.index({ url: 1 }, { unique: true }); // Уникальный индекс для предотвращения дубликатов
CarSchema.index({ createdAt: -1 }); // Для сортировки по дате
CarSchema.index({ status: 1 }); // Для фильтрации по статусу
CarSchema.index({ lastChecked: -1 }); // Для сортировки по дате проверки

// Составные индексы для частых запросов
CarSchema.index({ brand: 1, model: 1 });
CarSchema.index({ brand: 1, year: 1 });
CarSchema.index({ 'location.city': 1, brand: 1 });
CarSchema.index({ 'location.country': 1, 'location.city': 1 });
CarSchema.index({ listingType: 1 });
CarSchema.index({ auctionDate: 1 });
CarSchema.index({ 'startingPrice.USD': 1 });
CarSchema.index({ 'startingPrice.EUR': 1 });
CarSchema.index({ 'startingPrice.GBP': 1 });

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
