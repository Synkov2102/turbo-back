import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CacheModule } from '@nestjs/cache-manager';
import { ParserController } from './parser.controller';
import { AvitoParserService } from './avito-parser.service';
import { Car, CarSchema } from '../schemas/car.schema';
import { AutoRuParserService } from './autoru-parser.service';
import { StatusCheckerService } from './status-checker.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Car.name, schema: CarSchema }]),
    CacheModule.register(),
  ],
  controllers: [ParserController],
  providers: [AvitoParserService, AutoRuParserService, StatusCheckerService],
  exports: [StatusCheckerService],
})
export class ParserModule {}
