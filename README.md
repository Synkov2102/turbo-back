<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

### Docker

Приложение готово к деплою через Docker. Для сборки и запуска:

```bash
# Сборка образа
docker build -t turbo-back .

# Запуск контейнера
docker run -d \
  -p 3001:3001 \
  -e MONGO_URI=mongodb://host.docker.internal:27017/scraper \
  -e CORS_ORIGINS=https://yourdomain.com \
  --name turbo-back \
  turbo-back
```

### Переменные окружения

Скопируйте `env.example` в `.env` и настройте переменные:

- `PORT` - порт приложения (по умолчанию 3001)
- `MONGO_URI` - URI подключения к MongoDB
- `CORS_ORIGINS` - разрешенные источники через запятую
- `PROXY` или `PROXY_LIST` - прокси для парсинга (опционально)

### GitHub Actions CI/CD

Проект настроен с автоматическим деплоем через GitHub Actions:

- **CI** (`.github/workflows/ci.yml`) - запускается на каждый PR и push:
  - Линтинг кода
  - Сборка приложения
  - Проверка Docker образа

- **Deploy** (`.github/workflows/deploy.yml`) - запускается при push в `main`/`master`:
  - Сборка Docker образа
  - Публикация в GitHub Container Registry
  - Автоматический деплой на продакшн

#### Настройка деплоя

1. Образ автоматически публикуется в GitHub Container Registry: `ghcr.io/synkov2102/turbo-back:latest`

2. Для настройки деплоя на ваш сервер, отредактируйте `.github/workflows/deploy.yml` в секции `deploy`:
   - Добавьте SSH ключи в GitHub Secrets
   - Настройте команды для обновления контейнера на сервере
   - Или используйте docker-compose для управления

Пример настройки для SSH деплоя:
```yaml
- name: Deploy to production
  uses: appleboy/ssh-action@master
  with:
    host: ${{ secrets.SSH_HOST }}
    username: ${{ secrets.SSH_USERNAME }}
    key: ${{ secrets.SSH_KEY }}
    script: |
      cd /opt/turbo-back
      docker pull ghcr.io/synkov2102/turbo-back:latest
      docker-compose up -d
```

### Production Checklist

- [ ] Настроить переменные окружения на сервере
- [ ] Настроить MongoDB на продакшн
- [ ] Настроить CORS_ORIGINS для фронтенда
- [ ] Настроить прокси (если необходимо)
- [ ] Настроить мониторинг и логирование
- [ ] Настроить резервное копирование базы данных

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
