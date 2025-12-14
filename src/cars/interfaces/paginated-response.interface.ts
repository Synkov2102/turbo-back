import { Car } from '../../schemas/car.schema';

/**
 * Интерфейс для пагинированного ответа
 */
export interface PaginatedResponse<T> {
  /** Массив данных */
  data: T[];
  /** Метаданные пагинации */
  meta: {
    /** Текущая страница */
    page: number;
    /** Количество элементов на странице */
    limit: number;
    /** Общее количество элементов */
    total: number;
    /** Общее количество страниц */
    totalPages: number;
    /** Есть ли следующая страница */
    hasNext: boolean;
    /** Есть ли предыдущая страница */
    hasPrev: boolean;
  };
}
