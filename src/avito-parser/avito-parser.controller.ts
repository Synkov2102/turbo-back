import { Controller, Post, Body } from '@nestjs/common';
import { AvitoParserService } from './avito-parser.service';
import { Car } from '../schemas/car.schema';

@Controller('avito-parser')
export class AvitoParserController {
  constructor(private readonly avitoParserService: AvitoParserService) {}

  @Post('parse')
  async parseAvitoAd(@Body('url') url: string): Promise<Car> {
    return this.avitoParserService.parseAndSave(url);
  }
}
