import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync } from 'fs';
import { join } from 'path';

async function generateOpenApiSpec() {
  const app = await NestFactory.create(AppModule, { logger: false });

  const config = new DocumentBuilder()
    .setTitle('Turbo Back API')
    .setDescription('API для парсинга и работы с объявлениями об автомобилях')
    .setVersion('1.0')
    .addTag('cars', 'Операции с автомобилями')
    .addTag('parser', 'Парсинг объявлений с Avito, Auto.ru, ВКонтакте и других источников')
    .addTag('posts', 'Операции с постами из ВКонтакте')
    .addTag('captcha', 'Работа с капчей')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  // Сохраняем JSON
  const jsonPath = join(process.cwd(), 'openapi.json');
  writeFileSync(jsonPath, JSON.stringify(document, null, 2), {
    encoding: 'utf8',
  });
  console.log(`✅ OpenAPI спецификация сохранена в: ${jsonPath}`);

  // Сохраняем YAML (если нужен)
  // Для YAML нужно установить js-yaml: npm install --save-dev js-yaml @types/js-yaml
  // import * as yaml from 'js-yaml';
  // const yamlPath = join(process.cwd(), 'openapi.yaml');
  // writeFileSync(yamlPath, yaml.dump(document), { encoding: 'utf8' });
  // console.log(`✅ OpenAPI YAML спецификация сохранена в: ${yamlPath}`);

  await app.close();
}

generateOpenApiSpec().catch((error) => {
  console.error('Ошибка при генерации OpenAPI спецификации:', error);
  process.exit(1);
});

