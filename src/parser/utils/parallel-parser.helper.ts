import { Logger } from '@nestjs/common';

/**
 * Утилита для параллельной обработки задач с ограничением количества одновременных операций
 */
export class ParallelParserHelper {
  /**
   * Обрабатывает массив задач параллельно с ограничением количества одновременных операций
   * @param items Массив элементов для обработки
   * @param processor Функция обработки одного элемента
   * @param concurrency Максимальное количество одновременных операций (по умолчанию 3)
   * @param logger Логгер для вывода прогресса
   * @returns Массив результатов обработки
   */
  static async processInParallel<T, R>(
    items: T[],
    processor: (item: T, index: number) => Promise<R>,
    concurrency: number = 3,
    logger?: Logger,
  ): Promise<Array<{ item: T; result: R | null; error: string | null }>> {
    const effectiveConcurrency = concurrency;
    const results: Array<{
      item: T;
      result: R | null;
      error: string | null;
    }> = [];

    // Создаем массив промисов с ограничением параллелизма
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += effectiveConcurrency) {
      chunks.push(items.slice(i, i + effectiveConcurrency));
    }

    let processedCount = 0;
    const totalCount = items.length;

    for (const chunk of chunks) {
      const chunkPromises = chunk.map(async (item, chunkIndex) => {
        const globalIndex = processedCount + chunkIndex;
        try {
          if (logger) {
            logger.log(
              `Processing ${globalIndex + 1}/${totalCount} (${Math.round(((globalIndex + 1) / totalCount) * 100)}%)`,
            );
          }
          const result = await processor(item, globalIndex);
          return { item, result, error: null };
        } catch (error) {
          const errorMessage = (error as Error).message;
          if (logger) {
            logger.error(
              `Error processing item ${globalIndex + 1}/${totalCount}: ${errorMessage}`,
            );
          }
          return { item, result: null, error: errorMessage };
        }
      });

      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);
      processedCount += chunk.length;
    }

    return results;
  }

  /**
   * Обрабатывает массив задач параллельно с задержкой между батчами
   * @param items Массив элементов для обработки
   * @param processor Функция обработки одного элемента
   * @param concurrency Максимальное количество одновременных операций (по умолчанию 3)
   * @param delayBetweenBatches Задержка между батчами в миллисекундах (по умолчанию 1000)
   * @param logger Логгер для вывода прогресса
   * @returns Массив результатов обработки
   */
  static async processInParallelWithDelay<T, R>(
    items: T[],
    processor: (item: T, index: number) => Promise<R>,
    concurrency: number = 3,
    delayBetweenBatches: number = 1000,
    logger?: Logger,
  ): Promise<Array<{ item: T; result: R | null; error: string | null }>> {
    const effectiveConcurrency = concurrency;
    const effectiveDelay = delayBetweenBatches;
    const results: Array<{
      item: T;
      result: R | null;
      error: string | null;
    }> = [];

    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += effectiveConcurrency) {
      chunks.push(items.slice(i, i + effectiveConcurrency));
    }

    let processedCount = 0;
    const totalCount = items.length;

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      const chunkPromises = chunk.map(async (item, itemIndex) => {
        const globalIndex = processedCount + itemIndex;
        try {
          if (logger) {
            logger.log(
              `Processing ${globalIndex + 1}/${totalCount} (${Math.round(((globalIndex + 1) / totalCount) * 100)}%)`,
            );
          }
          const result = await processor(item, globalIndex);
          return { item, result, error: null };
        } catch (error) {
          const errorMessage = (error as Error).message;
          if (logger) {
            logger.error(
              `Error processing item ${globalIndex + 1}/${totalCount}: ${errorMessage}`,
            );
          }
          return { item, result: null, error: errorMessage };
        }
      });

      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);
      processedCount += chunk.length;

      // Задержка между батчами (кроме последнего)
      if (chunkIndex < chunks.length - 1 && effectiveDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, effectiveDelay));
      }
    }

    return results;
  }
}
