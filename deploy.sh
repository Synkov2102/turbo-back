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
if ! command -v docker-compose &> /dev/null; then
    echo "❌ docker-compose не найден. Установите docker-compose."
    exit 1
fi

# Останавливаем старый контейнер
echo "⏹️  Останавливаем старый контейнер..."
docker-compose down || true

# Обновляем образ
echo "📥 Загружаем новый образ..."
docker pull ${FULL_IMAGE}

# Обновляем docker-compose.yml с новым образом
if [ -f docker-compose.prod.yml ]; then
    # Если есть продакшн конфиг, используем его
    sed -i "s|image:.*|image: ${FULL_IMAGE}|g" docker-compose.prod.yml
    docker-compose -f docker-compose.prod.yml up -d
else
    # Иначе обновляем основной файл
    sed -i "s|image:.*|image: ${FULL_IMAGE}|g" docker-compose.yml
    docker-compose up -d
fi

# Очищаем старые образы
echo "🧹 Очищаем неиспользуемые образы..."
docker image prune -f

echo "✅ Деплой завершен!"
echo "📊 Статус контейнеров:"
docker-compose ps

