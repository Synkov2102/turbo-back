#!/bin/bash

# Скрипт для деплоя на продакшн сервер
# Использование: ./deploy.sh [tag]
# tag - тег образа (по умолчанию latest)

set -e

IMAGE_NAME="ghcr.io/${GITHUB_REPOSITORY:-synkov2102/turbo-back}"
TAG=${1:-latest}
FULL_IMAGE="${IMAGE_NAME}:${TAG}"

echo "🚀 Начинаем деплой ${FULL_IMAGE}"

# Проверяем наличие docker-compose
if ! command -v docker-compose &> /dev/null && ! command -v docker &> /dev/null; then
    echo "❌ docker-compose или docker не найден. Установите docker."
    exit 1
fi

# Определяем команду для docker-compose (v1 или v2)
if command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE_CMD="docker-compose"
elif docker compose version &>/dev/null; then
    DOCKER_COMPOSE_CMD="docker compose"
else
    echo "❌ Не найдена команда docker-compose"
    exit 1
fi

# Останавливаем старый контейнер
echo "⏹️  Останавливаем старый контейнер..."
$DOCKER_COMPOSE_CMD -f docker-compose.prod.yml down --remove-orphans 2>/dev/null || true

# Останавливаем контейнеры, использующие порт 3002
echo "🛑 Останавливаем контейнеры на порту 3002..."
docker ps --format "{{.ID}} {{.Ports}}" | grep ":3002->" | awk '{print $1}' | xargs -r docker stop 2>/dev/null || true
docker ps -a --format "{{.ID}} {{.Ports}}" | grep ":3002->" | awk '{print $1}' | xargs -r docker rm -f 2>/dev/null || true

# Обновляем образ с повторными попытками
echo "📥 Загружаем новый образ..."
MAX_RETRIES=3
RETRY_COUNT=0
while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if docker pull ${FULL_IMAGE}; then
        echo "✅ Образ успешно загружен"
        break
    else
        RETRY_COUNT=$((RETRY_COUNT + 1))
        if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
            echo "⚠️  Попытка $RETRY_COUNT не удалась, повторяем через 5 секунд..."
            sleep 5
        else
            echo "❌ Не удалось загрузить образ после $MAX_RETRIES попыток"
            exit 1
        fi
    fi
done

# Обновляем docker-compose.prod.yml с новым образом
if [ -f docker-compose.prod.yml ]; then
    echo "📝 Обновляем docker-compose.prod.yml..."
    sed -i "s|image:.*|image: ${FULL_IMAGE}|g" docker-compose.prod.yml
    
    # Убеждаемся, что используется порт 3002
    sed -i 's/\${PORT:-3001}:3001/\${PORT:-3002}:3002/g' docker-compose.prod.yml || true
    sed -i 's/"3001:3001"/"${PORT:-3002}:3002"/g' docker-compose.prod.yml || true
    sed -i 's/3001:3001/3002:3002/g' docker-compose.prod.yml || true
    sed -i 's/PORT=3001/PORT=3002/g' docker-compose.prod.yml || true
    
    echo "🔄 Запускаем контейнеры..."
    $DOCKER_COMPOSE_CMD -f docker-compose.prod.yml up -d --force-recreate --remove-orphans
else
    echo "⚠️  docker-compose.prod.yml не найден, используем docker-compose.yml"
    if [ -f docker-compose.yml ]; then
        sed -i "s|image:.*|image: ${FULL_IMAGE}|g" docker-compose.yml
        $DOCKER_COMPOSE_CMD -f docker-compose.yml up -d --force-recreate --remove-orphans
    else
        echo "❌ Не найден ни docker-compose.prod.yml, ни docker-compose.yml"
        exit 1
    fi
fi

# Очищаем старые образы
echo "🧹 Очищаем неиспользуемые образы..."
docker image prune -f

echo "✅ Деплой завершен!"
echo "📊 Статус контейнеров:"
$DOCKER_COMPOSE_CMD -f docker-compose.prod.yml ps 2>/dev/null || $DOCKER_COMPOSE_CMD ps

