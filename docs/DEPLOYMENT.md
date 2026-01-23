# Руководство по деплою

## Подготовка к деплою

### 1. Настройка переменных окружения

Создайте файл `.env` на сервере на основе `env.example`:

```bash
PORT=3002
NODE_ENV=production
MONGO_URI=mongodb://mongo:27017/scraper
CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
```

> **Примечание:** `PORT` - это внешний порт на хосте (по умолчанию 3002). Внутри контейнера приложение всегда работает на порту 3001.

### 2. Настройка GitHub Secrets

Для автоматического деплоя через GitHub Actions настройте следующие secrets в настройках репозитория:

**Для SSH деплоя:**
- `VPS_SSH_HOST` - IP адрес или домен сервера
- `VPS_SSH_USER` - пользователь для SSH подключения
- `VPS_SSH_KEY_B64` - приватный SSH ключ в формате base64
- `VPS_DEPLOY_PATH` - путь к директории с docker-compose на сервере (опционально, по умолчанию `/opt/turbo-back`)

> **Почему `/opt/turbo-back`?**  
> `/opt` - это стандартная директория для опционального программного обеспечения согласно FHS (Filesystem Hierarchy Standard). Это более правильный выбор для продакшн окружения, чем `/app`.

**Как получить base64 ключ:**
```bash
# На вашем локальном компьютере
cat ~/.ssh/id_rsa | base64 -w 0
# Или на macOS
cat ~/.ssh/id_rsa | base64
```

Скопируйте весь вывод (одну длинную строку) и вставьте в GitHub Secret `VPS_SSH_KEY_B64`.

**Для Docker Hub (альтернатива):**
- `DOCKER_USERNAME` - имя пользователя Docker Hub
- `DOCKER_PASSWORD` - пароль или токен доступа

## Варианты деплоя

### Вариант 1: Автоматический деплой через GitHub Actions

1. Настройте GitHub Secrets:
   - `VPS_SSH_HOST` - адрес вашего сервера
   - `VPS_SSH_USER` - пользователь для SSH (обычно `root` или `deploy`)
   - `VPS_SSH_KEY_B64` - приватный SSH ключ в base64 формате
   - `VPS_DEPLOY_PATH` - путь на сервере (опционально, по умолчанию `/opt/turbo-back`)

2. Workflow уже настроен и будет автоматически деплоить при push в `main`/`master`

3. При каждом push в `main`/`master` будет автоматически:
   - Собран Docker образ
   - Опубликован в GitHub Container Registry
   - Задеплоен на сервер через SSH

### Вариант 2: Ручной деплой через Docker

На сервере:

```bash
# Клонируйте репозиторий
git clone https://github.com/Synkov2102/turbo-back.git
cd turbo-back

# Создайте .env файл
cp env.example .env
nano .env  # Настройте переменные

# Соберите и запустите
docker-compose up -d
```

### Вариант 3: Деплой готового образа

```bash
# На сервере создайте директорию
mkdir -p /opt/turbo-back
cd /opt/turbo-back

# Создайте docker-compose.prod.yml (скопируйте из репозитория)
# Создайте .env файл

# Запустите деплой скрипт
curl -o deploy.sh https://raw.githubusercontent.com/Synkov2102/turbo-back/main/deploy.sh
chmod +x deploy.sh
./deploy.sh
```

### Вариант 4: Использование скрипта deploy.sh

1. Скопируйте `deploy.sh` на сервер
2. Настройте переменную окружения `GITHUB_REPOSITORY` (например, `Synkov2102/turbo-back`)
3. Запустите:

```bash
./deploy.sh latest  # или конкретный тег
```

## Проверка деплоя

После деплоя проверьте:

```bash
# Статус контейнеров
docker-compose ps

# Логи приложения
docker-compose logs -f app

# Healthcheck
curl http://localhost:3001/api
```

## Обновление приложения

### Автоматическое обновление

При push в `main`/`master` обновление происходит автоматически через GitHub Actions.

### Ручное обновление

```bash
# На сервере
cd /opt/turbo-back
docker pull ghcr.io/synkov2102/turbo-back:latest
docker-compose -f docker-compose.prod.yml up -d
```

## Мониторинг

### Логи

```bash
# Просмотр логов
docker-compose logs -f app

# Последние 100 строк
docker-compose logs --tail=100 app
```

### Healthcheck

Приложение имеет встроенный healthcheck, который проверяет доступность API каждые 30 секунд.

### Метрики

Для мониторинга можно использовать:
- Docker stats: `docker stats turbo-back`
- Prometheus + Grafana
- Логирование в внешний сервис (ELK, Loki и т.д.)

## Откат к предыдущей версии

```bash
# Список доступных тегов
docker images | grep turbo-back

# Откат к конкретной версии
docker pull ghcr.io/synkov2102/turbo-back:main-abc1234
docker tag ghcr.io/synkov2102/turbo-back:main-abc1234 ghcr.io/synkov2102/turbo-back:latest
docker-compose -f docker-compose.prod.yml up -d
```

## Устранение проблем

### Контейнер не запускается

1. Проверьте логи: `docker-compose logs app`
2. Проверьте переменные окружения: `docker-compose config`
3. Проверьте подключение к MongoDB
4. Проверьте доступность портов

### Проблемы с Puppeteer

Если возникают проблемы с Puppeteer в контейнере:
- Убедитесь, что все зависимости установлены (они включены в Dockerfile)
- Проверьте права доступа к `/tmp` и другим директориям
- Убедитесь, что контейнер запущен не от root (для безопасности)

### Проблемы с памятью

Puppeteer может потреблять много памяти. Если контейнер падает:
- Увеличьте лимиты памяти в docker-compose
- Настройте ограничения для Puppeteer
- Используйте headless режим (уже включен по умолчанию)

## Безопасность

1. **Никогда не коммитьте `.env` файлы** в репозиторий
2. Используйте сильные пароли для MongoDB
3. Настройте firewall на сервере
4. Используйте HTTPS для фронтенда (настройте reverse proxy)
5. Регулярно обновляйте зависимости: `npm audit fix`
6. Используйте secrets для хранения чувствительных данных

## Резервное копирование

Настройте регулярное резервное копирование MongoDB:

```bash
# Пример скрипта бэкапа
docker exec turbo-back-mongo mongodump --out /backup/$(date +%Y%m%d)
```

