import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ParserController } from './parser.controller';
import { AvitoParserService } from './avito-parser.service';
import { Car, CarSchema } from '../schemas/car.schema';
import { AutoRuParserService } from './autoru-parser.service';
import { OldtimerfarmParserService } from './oldtimerfarm-parser.service';
import { RmsothebysParserService } from './rmsothebys-parser.service';
import { StatusCheckerService } from './status-checker.service';
import { CronParserService } from './cron-parser.service';
import { CarsModule } from '../cars/cars.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Car.name, schema: CarSchema }]),
    CarsModule,
  ],
  controllers: [ParserController],
  providers: [
    AvitoParserService,
    AutoRuParserService,
    OldtimerfarmParserService,
    RmsothebysParserService,
    StatusCheckerService,
    CronParserService,
  ],
  exports: [StatusCheckerService],
})
export class ParserModule { }
