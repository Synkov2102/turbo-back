import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Query,
  Patch,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { AvitoParserService } from './avito-parser.service';
import { AutoRuParserService } from './autoru-parser.service';
import { StatusCheckerService } from './status-checker.service';
import { Car } from '../schemas/car.schema';
import { ParseAvitoDto } from './dto/parse-avito.dto';
import { StatusCheckResultDto } from './dto/status-check-result.dto';
import { StatusCheckResult } from './interfaces/status-check-result.interface';

@ApiTags('parser')
@Controller('parser')
export class ParserController {
  constructor(
    private readonly avitoParserService: AvitoParserService,
    private readonly autoruParserService: AutoRuParserService,
    private readonly statusCheckerService: StatusCheckerService,
  ) {}

  @Post('avito')
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

  @Post('autoru')
  @ApiOperation({
    summary: 'Распарсить объявление с Auto.ru и сохранить в базу данных',
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
  async parseAutoRuAd(@Body() dto: ParseAvitoDto): Promise<Car> {
    return this.autoruParserService.parseAndSave(dto.url);
  }

  @Patch('check-status/:id')
  @ApiOperation({
    summary: 'Проверить статус объявления по ID автомобиля',
  })
  @ApiParam({
    name: 'id',
    description: 'ID автомобиля',
    example: '507f1f77bcf86cd799439011',
  })
  @ApiResponse({
    status: 200,
    description: 'Статус объявления обновлен',
    type: Car,
  })
  @ApiResponse({
    status: 404,
    description: 'Автомобиль не найден',
  })
  async checkCarStatus(@Param('id') id: string): Promise<Car> {
    const car = await this.statusCheckerService.updateCarStatus(id);
    if (!car) {
      throw new Error('Car not found');
    }
    return car;
  }

  @Get('check-status')
  @ApiOperation({
    summary: 'Проверить статус старых активных и unknown объявлений',
    description:
      'Проверяет все активные и unknown объявления, которые не проверялись более указанного количества дней. Возвращает список проверенных автомобилей, статистику и список тех, у которых изменился статус.',
  })
  @ApiQuery({
    name: 'daysOld',
    required: false,
    type: Number,
    description: 'Проверять объявления старше N дней (по умолчанию 7)',
    example: 7,
  })
  @ApiQuery({
    name: 'checkAll',
    required: false,
    type: Boolean,
    description:
      'Проверять все объявления, не только активные (по умолчанию false)',
    example: false,
  })
  @ApiResponse({
    status: 200,
    description: 'Результат проверки со статистикой',
    type: StatusCheckResultDto,
  })
  async checkOldCars(
    @Query('daysOld') daysOld?: string,
    @Query('checkAll') checkAll?: string,
  ): Promise<StatusCheckResult> {
    const days = daysOld ? parseInt(daysOld, 10) : 7;
    const checkAllFlag = checkAll === 'true' || checkAll === '1';
    return this.statusCheckerService.checkOldActiveCars(days, checkAllFlag);
  }
}
