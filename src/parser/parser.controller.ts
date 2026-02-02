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
import { OldtimerfarmParserService } from './oldtimerfarm-parser.service';
import { RmsothebysParserService } from './rmsothebys-parser.service';
import { StatusCheckerService } from './status-checker.service';
import { CronParserService } from './cron-parser.service';
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
    private readonly oldtimerfarmParserService: OldtimerfarmParserService,
    private readonly rmsothebysParserService: RmsothebysParserService,
    private readonly statusCheckerService: StatusCheckerService,
    private readonly cronParserService: CronParserService,
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

  @Post('oldtimerfarm')
  @ApiOperation({
    summary: 'Распарсить объявление с Oldtimerfarm.be и сохранить в базу данных',
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
  @ApiResponse({
    status: 404,
    description: 'Объявление не найдено или это мотоцикл',
  })
  async parseOldtimerfarmAd(@Body() dto: ParseAvitoDto): Promise<Car> {
    const car = await this.oldtimerfarmParserService.parseAndSave(dto.url);
    if (!car) {
      throw new Error('Объявление не найдено или это мотоцикл');
    }
    return car;
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

  @Post('oldtimerfarm/parse-all')
  @ApiOperation({
    summary: 'Парсинг Oldtimerfarm',
    description:
      'Парсит актуальные объявления с Oldtimerfarm: обновляет существующие, добавляет новые, помечает отсутствующие в новом парсе как removed.',
  })
  @ApiResponse({
    status: 200,
    description: 'Парсинг завершен',
  })
  async parseAllOldtimerfarmCars(): Promise<{ message: string }> {
    await this.cronParserService.parseOldtimerfarm();
    return { message: 'Парсинг Oldtimerfarm завершен' };
  }

  @Post('rmsothebys/parse')
  @ApiOperation({
    summary: "Распарсить конкретное объявление с RM Sotheby's и сохранить в базу данных",
    description:
      "Парсит одну ссылку с RM Sotheby's, извлекает все данные об автомобиле и сохраняет/обновляет запись в базе данных",
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
  async parseRmsothebysAd(@Body() dto: ParseAvitoDto): Promise<Car> {
    return this.rmsothebysParserService.parseAndSave(dto.url);
  }

  @Post('rmsothebys')
  @ApiOperation({
    summary: "Распарсить объявление с RM Sotheby's и сохранить в базу данных",
    deprecated: true,
    description:
      'Используйте /parser/rmsothebys/parse вместо этого эндпоинта',
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
  async parseRmsothebysAdOld(@Body() dto: ParseAvitoDto): Promise<Car> {
    return this.rmsothebysParserService.parseAndSave(dto.url);
  }

  @Post('rmsothebys/parse-all')
  @ApiOperation({
    summary: "Парсинг RM Sotheby's",
    description:
      "Парсит актуальные объявления с RM Sotheby's: обновляет существующие, добавляет новые, помечает отсутствующие в новом парсе как removed.",
  })
  @ApiResponse({
    status: 200,
    description: 'Парсинг завершен',
  })
  async parseAllRmsothebysCars(): Promise<{ message: string }> {
    await this.cronParserService.parseRmsothebys();
    return { message: "Парсинг RM Sotheby's завершен" };
  }

  @Post('parse-full-cycle')
  @ApiOperation({
    summary: 'Полный цикл парсинга',
    description:
      'Парсинг Oldtimerfarm, парсинг RM Sothebys, обновление цен в рублях. Обновляет существующие, добавляет новые, помечает отсутствующие как removed.',
  })
  @ApiResponse({
    status: 200,
    description: 'Полный цикл парсинга завершен',
  })
  async runFullParseCycle(): Promise<{ message: string }> {
    await this.cronParserService.runFullParseCycle();
    return { message: 'Полный цикл парсинга завершен' };
  }

  @Post('check-autoru')
  @ApiOperation({
    summary: 'Проверить статус объявлений Auto.ru',
    description:
      'Проверяет активные и unknown объявления Auto.ru, которые не проверялись более указанного количества дней (по умолчанию 7).',
  })
  @ApiResponse({
    status: 200,
    description: 'Проверка завершена',
  })
  async checkAutoRuCars(): Promise<{ message: string }> {
    await this.cronParserService.checkAutoRuCars();
    return { message: 'Проверка Auto.ru завершена' };
  }
}
