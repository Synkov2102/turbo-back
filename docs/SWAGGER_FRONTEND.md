# Использование Swagger/OpenAPI спецификации на фронтенде

## Способы получения OpenAPI спецификации

### 1. Через HTTP endpoint (рекомендуется)

Swagger автоматически предоставляет JSON спецификацию по следующим адресам:

- **JSON формат**: `http://localhost:3002/api-json`
- **YAML формат**: `http://localhost:3002/api-yaml`
- **Swagger UI**: `http://localhost:3002/api`

#### Использование на фронтенде:

```typescript
// Получить спецификацию
const response = await fetch('http://localhost:3002/api-json');
const openApiSpec = await response.json();
```

### 2. Экспорт в файл

Запустите команду для генерации файла `openapi.json`:

```bash
npm run generate:openapi
```

Это создаст файл `openapi.json` в корне проекта, который можно:
- Передать фронтенд-команде
- Использовать для генерации TypeScript клиента
- Импортировать в Postman/Insomnia
- Использовать в других инструментах

### 3. Генерация TypeScript клиента (рекомендуется для фронтенда)

#### Используя openapi-generator:

```bash
# Установить openapi-generator
npm install -g @openapitools/openapi-generator-cli

# Сгенерировать клиент
openapi-generator-cli generate \
  -i http://localhost:3002/api-json \
  -g typescript-axios \
  -o ./frontend/src/api
```

#### Используя openapi-typescript-codegen:

```bash
# Установить
npm install --save-dev openapi-typescript-codegen

# Сгенерировать клиент
npx openapi-typescript-codegen --input http://localhost:3002/api-json --output ./frontend/src/api
```

#### Используя swagger-typescript-api:

```bash
# Установить
npm install -g swagger-typescript-api

# Сгенерировать клиент
swagger-typescript-api -p http://localhost:3002/api-json -o ./frontend/src/api -n api.ts
```

### 4. Использование в Cursor/IDE

Если вы используете Cursor или другой AI-ассистент:

1. **Скопируйте URL спецификации**:
   ```
   http://localhost:3002/api-json
   ```

2. **Или скопируйте содержимое файла** `openapi.json` после генерации

3. **Передайте в промпт**:
   ```
   Используй эту OpenAPI спецификацию для создания TypeScript клиента:
   [вставить URL или содержимое JSON]
   ```

### 5. Интеграция с фронтенд-проектом

#### React/Next.js пример:

```typescript
// lib/api-client.ts
import axios from 'axios';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

// Загрузить спецификацию
export async function getOpenApiSpec() {
  const response = await axios.get(`${API_BASE_URL}/api-json`);
  return response.data;
}

// Использовать для валидации или генерации типов
```

#### Vue пример:

```typescript
// services/api.ts
import axios from 'axios';

export async function fetchOpenApiSpec() {
  const { data } = await axios.get('http://localhost:3002/api-json');
  return data;
}
```

## Автоматическая генерация клиента в CI/CD

Добавьте в ваш CI/CD pipeline:

```yaml
# .github/workflows/generate-api-client.yml
name: Generate API Client

on:
  push:
    branches: [main]

jobs:
  generate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Start API server
        run: |
          npm install
          npm run start:dev &
          sleep 10
      - name: Generate OpenAPI spec
        run: npm run generate:openapi
      - name: Generate TypeScript client
        run: |
          npx openapi-typescript-codegen \
            --input openapi.json \
            --output ./frontend/src/api
```

## Полезные ссылки

- [OpenAPI Specification](https://swagger.io/specification/)
- [Swagger UI](https://swagger.io/tools/swagger-ui/)
- [openapi-typescript-codegen](https://github.com/ferdikoomen/openapi-typescript-codegen)
- [swagger-typescript-api](https://github.com/acacode/swagger-typescript-api)

