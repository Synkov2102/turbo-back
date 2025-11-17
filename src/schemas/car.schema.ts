import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type CarDocument = Car & Document;

@Schema()
export class Car {
  @Prop({ required: true })
  title: string;

  @Prop()
  brand: string;

  @Prop()
  model: string;

  @Prop()
  year: number;

  @Prop()
  price: number;

  @Prop()
  mileage: number;

  @Prop()
  city: string;

  @Prop()
  transmission: string;

  @Prop()
  engineVolume: number;

  @Prop()
  description: string;

  @Prop({ required: true })
  url: string;

  @Prop({ type: [String] })
  images: string[];

  @Prop({ default: Date.now })
  createdAt: Date;
}

export const CarSchema = SchemaFactory.createForClass(Car);

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
