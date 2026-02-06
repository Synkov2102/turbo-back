# Multi-stage build для оптимизации размера образа
FROM node:20-slim AS builder

# Установка зависимостей для сборки
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Настройка переменных окружения для Puppeteer (пропускаем загрузку Chromium в builder stage)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Копируем package.json и package-lock.json для более быстрой установки
COPY package.json package-lock.json* ./
COPY tsconfig*.json nest-cli.json ./

# Устанавливаем зависимости с увеличенными таймаутами
RUN npm ci --prefer-offline --no-audit || npm install --prefer-offline --no-audit

# Копируем исходный код
COPY . .

# Собираем приложение
RUN npm run build

# Production образ
FROM node:20-slim

# Установка зависимостей для Puppeteer (Chrome/Chromium)
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libwayland-client0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    libu2f-udev \
    libvulkan1 \
    chromium \
    chromium-sandbox \
    && rm -rf /var/lib/apt/lists/*

# Настройка переменных окружения для Puppeteer (использование системного Chromium)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
# Crashpad в Docker требует записываемый каталог для --database
ENV TMPDIR=/tmp
ENV HOME=/tmp
ENV XDG_CACHE_HOME=/tmp/.cache
ENV XDG_CONFIG_HOME=/tmp/.config

WORKDIR /app

# Копируем package.json и package-lock.json для установки только production зависимостей
COPY package.json package-lock.json* ./

# Устанавливаем только production зависимости с увеличенными таймаутами
RUN npm ci --omit=dev --prefer-offline --no-audit || npm install --omit=dev --prefer-offline --no-audit && npm cache clean --force

# Копируем собранное приложение из builder stage
COPY --from=builder /app/dist ./dist

# Создаем пользователя для безопасности
RUN groupadd -r appuser && useradd -r -g appuser appuser
RUN chown -R appuser:appuser /app
# Каталоги для Chromium/crashpad (должны существовать и быть записываемыми)
RUN mkdir -p /tmp/.cache /tmp/.config && chown -R appuser:appuser /tmp/.cache /tmp/.config
USER appuser

# Открываем порт
EXPOSE 3002

# Переменные окружения по умолчанию
ENV NODE_ENV=production
ENV PORT=3002

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3002/api', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Запуск приложения
CMD ["node", "dist/src/main.js"]
