import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ParserController } from './parser.controller';
import { CaptchaController } from './captcha.controller';
import { AvitoParserService } from './avito-parser.service';
import { Car, CarSchema } from '../schemas/car.schema';
import { AutoRuParserService } from './autoru-parser.service';
import { OldtimerfarmParserService } from './oldtimerfarm-parser.service';
import { RmsothebysParserService } from './rmsothebys-parser.service';
import { StatusCheckerService } from './status-checker.service';
import { CronParserService } from './cron-parser.service';
import { CaptchaService } from './captcha.service';
import { TelegramService } from './telegram.service';
import { CaptchaSessionService } from './captcha-session.service';
import { CarsModule } from '../cars/cars.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Car.name, schema: CarSchema }]),
    CarsModule,
  ],
  controllers: [ParserController, CaptchaController],
  providers: [
    AvitoParserService,
    AutoRuParserService,
    OldtimerfarmParserService,
    RmsothebysParserService,
    StatusCheckerService,
    CronParserService,
    CaptchaService,
    TelegramService,
    CaptchaSessionService,
  ],
  exports: [StatusCheckerService],
})
export class ParserModule {}
