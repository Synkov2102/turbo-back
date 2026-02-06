import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { ParserModule } from './parser/parser.module';
import { CarsModule } from './cars/cars.module';
import { PostsModule } from './posts/posts.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // В Docker: переменные передаются через docker-compose env_file → process.env
      // ConfigModule автоматически читает из process.env (который заполнен через env_file)
      // Локально: ConfigModule попытается прочитать .env файл, если он существует
      envFilePath: '.env',
      // ignoreEnvFile: false - читает и из файла и из process.env (process.env имеет приоритет)
      // В Docker переменные из env_file уже в process.env, поэтому файл не нужен
    }),
    ScheduleModule.forRoot(),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        uri:
          configService.get<string>('MONGO_URI') ||
          'mongodb://localhost:27017/scraper',
        // Оптимизация для скорости записи
        maxPoolSize: 50, // Увеличиваем размер пула соединений
        minPoolSize: 10, // Минимальный размер пула
        // Оптимизация для bulk операций
        writeConcern: {
          w: 1, // Минимальный write concern для скорости (1 = подтверждение от primary)
          j: false, // Не ждать записи на диск (для скорости)
        },
      }),
      inject: [ConfigService],
    }),
    ParserModule,
    CarsModule,
    PostsModule,
  ],
})
export class AppModule {}
