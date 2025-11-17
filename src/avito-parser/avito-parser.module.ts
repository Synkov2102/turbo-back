import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CacheModule } from '@nestjs/cache-manager';
import { AvitoParserController } from './avito-parser.controller';
import { AvitoParserService } from './avito-parser.service';
import { Car, CarSchema } from '../schemas/car.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Car.name, schema: CarSchema }]),
    CacheModule.register(),
  ],
  controllers: [AvitoParserController],
  providers: [AvitoParserService],
})
export class AvitoParserModule {}
