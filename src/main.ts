import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { initializeProxies } from './parser/utils/browser-helper';

async function bootstrap() {
  // Инициализируем прокси при старте приложения
  initializeProxies();

  const app = await NestFactory.create(AppModule);

  // Глобальная валидация
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Удаляет свойства, которых нет в DTO
      forbidNonWhitelisted: true, // Выбрасывает ошибку при наличии лишних свойств
      transform: true, // Автоматически преобразует типы
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Включаем CORS
  app.enableCors({
    origin: [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:4200',
      'http://localhost:8080',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
      'http://127.0.0.1:4200',
      'http://127.0.0.1:8080',
    ],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // Настройка Swagger
  const config = new DocumentBuilder()
    .setTitle('Turbo Back API')
    .setDescription('API для парсинга и работы с объявлениями об автомобилях')
    .setVersion('1.0')
    .addTag('cars', 'Операции с автомобилями')
    .addTag('parser', 'Парсинг объявлений с Avito и Auto.ru')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  // Экспорт спецификации доступен по адресам:
  // - /api-json (JSON формат)
  // - /api-yaml (YAML формат)

  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
