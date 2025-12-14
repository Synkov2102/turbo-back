import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { AvitoParserService } from './avito-parser.service';
import { Car } from '../schemas/car.schema';
import { ParseAvitoDto } from './dto/parse-avito.dto';

@ApiTags('avito-parser')
@Controller('avito-parser')
export class AvitoParserController {
  constructor(private readonly avitoParserService: AvitoParserService) {}

  @Post('parse')
  @ApiOperation({
    summary: 'Распарсить объявление с Avito и сохранить в базу данных',
  })
  @ApiBody({ type: ParseAvitoDto })
  @ApiResponse({
    status: 201,
    description: 'Объявление успешно распарсено и сохранено',
    type: Car,
  })
  @ApiResponse({
    status: 400,
    description: 'Неверный URL',
  })
  async parseAvitoAd(@Body() dto: ParseAvitoDto): Promise<Car> {
    return this.avitoParserService.parseAndSave(dto.url);
  }
}
