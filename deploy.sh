#!/bin/bash
# Скрипт для деплоя на продакшн сервер
# Использование: ./deploy.sh [tag]

set -e

IMAGE_NAME="ghcr.io/${GITHUB_REPOSITORY:-synkov2102/turbo-back}"
TAG=${1:-latest}
FULL_IMAGE="${IMAGE_NAME}:${TAG}"
COMPOSE_FILE="docker-compose.prod.yml"

echo "🚀 Деплой ${FULL_IMAGE}"

# Определяем команду docker-compose (v1 или v2)
if docker compose version &>/dev/null 2>&1; then
    DOCKER_COMPOSE="docker compose"
elif command -v docker-compose &>/dev/null; then
    DOCKER_COMPOSE="docker-compose"
else
    echo "❌ docker-compose не найден"
    exit 1
fi

# Проверяем наличие compose файла
if [ ! -f "$COMPOSE_FILE" ]; then
    COMPOSE_FILE="docker-compose.yml"
    if [ ! -f "$COMPOSE_FILE" ]; then
        echo "❌ Не найден docker-compose файл"
        exit 1
    fi
fi

# Останавливаем старые контейнеры
echo "⏹️  Остановка старых контейнеров..."
$DOCKER_COMPOSE -f "$COMPOSE_FILE" down --remove-orphans 2>/dev/null || true

# Загружаем образ с повторными попытками
echo "📥 Загрузка образа..."
for i in {1..3}; do
    if docker pull "$FULL_IMAGE"; then
        echo "✅ Образ загружен"
        break
    elif [ $i -lt 3 ]; then
        echo "⚠️  Попытка $i не удалась, повтор через 5 сек..."
        sleep 5
    else
        echo "❌ Не удалось загрузить образ"
        exit 1
    fi
done

# Обновляем образ в compose файле
sed -i "s|image:.*|image: ${FULL_IMAGE}|g" "$COMPOSE_FILE"

# Запускаем контейнеры
echo "🔄 Запуск контейнеров..."
$DOCKER_COMPOSE -f "$COMPOSE_FILE" up -d --force-recreate --remove-orphans

# Очистка
echo "🧹 Очистка старых образов..."
docker image prune -f

echo "✅ Деплой завершен"
$DOCKER_COMPOSE -f "$COMPOSE_FILE" ps

