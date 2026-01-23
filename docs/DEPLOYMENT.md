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

> **Примечание:** `PORT` - это внешний порт на хосте (по умолчанию 3002). Внутри контейнера приложение всегда работает на порту 3002.

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

### Вариант 2: Ручной деплой через скрипт deploy.sh

```bash
# На сервере
mkdir -p /opt/turbo-back
cd /opt/turbo-back

# Скопируйте docker-compose.prod.yml и создайте .env файл
# Скачайте скрипт деплоя
curl -o deploy.sh https://raw.githubusercontent.com/Synkov2102/turbo-back/main/deploy.sh
chmod +x deploy.sh

# Запустите деплой
./deploy.sh latest  # или конкретный тег
```

### Вариант 3: Ручной деплой через docker-compose

```bash
# На сервере
cd /opt/turbo-back
docker pull ghcr.io/synkov2102/turbo-back:latest
docker compose -f docker-compose.prod.yml up -d
```

## Проверка и обновление

### Проверка деплоя

```bash
# Статус контейнеров
docker compose -f docker-compose.prod.yml ps

# Логи приложения
docker compose -f docker-compose.prod.yml logs -f app

# Healthcheck
curl http://localhost:3002/api
```

### Обновление

**Автоматическое:** При push в `main`/`master` через GitHub Actions

**Ручное:**
```bash
cd /opt/turbo-back
./deploy.sh  # или docker compose -f docker-compose.prod.yml up -d --pull always
```

## Мониторинг

```bash
# Логи
docker compose -f docker-compose.prod.yml logs -f app
docker compose -f docker-compose.prod.yml logs --tail=100 app

# Статистика
docker stats turbo-back

# Healthcheck (встроенный, проверка каждые 30 сек)
```

Для продвинутого мониторинга: Prometheus + Grafana, ELK, Loki

## Откат к предыдущей версии

```bash
# Откат к конкретной версии
./deploy.sh main-abc1234  # или другой тег
```

## Устранение проблем

### Контейнер не запускается

```bash
# Проверка логов
docker compose -f docker-compose.prod.yml logs app

# Проверка конфигурации
docker compose -f docker-compose.prod.yml config

# Проверка подключения к MongoDB и портов
```

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

### Проблемы с SSH соединением при деплое

Если при деплое через GitHub Actions происходит разрыв SSH соединения (`Broken pipe`):

1. **Настройте SSH на сервере** для предотвращения таймаутов:
   ```bash
   # На сервере отредактируйте /etc/ssh/sshd_config
   sudo nano /etc/ssh/sshd_config
   
   # Добавьте или измените следующие параметры:
   ClientAliveInterval 60
   ClientAliveCountMax 3
   TCPKeepAlive yes
   
   # Перезапустите SSH сервис
   sudo systemctl restart sshd
   ```

2. **Настройте SSH клиент** в GitHub Actions workflow (если используете):
   ```yaml
   ssh -o ServerAliveInterval=60 -o ServerAliveCountMax=3 -o StrictHostKeyChecking=no ...
   ```

3. **Используйте улучшенный скрипт deploy.sh** - он включает повторные попытки загрузки образа

4. **Альтернатива**: Загрузите образ вручную на сервере, затем запустите скрипт:
   ```bash
   # На сервере
   docker pull ghcr.io/synkov2102/turbo-back:latest
   ./deploy.sh
   ```

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

