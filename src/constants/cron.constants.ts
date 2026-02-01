/**
 * Расписание cron-задач.
 * Формат: секунда минута час день месяц день_недели
 * Пример: '0 30 14 * * *' — каждый день в 14:30
 */

/** Парсинг OldTimerFarm — каждый день в 4:00 */
export const CRON_OLDTIMERFARM = '0 0 4 * * *';

/** Парсинг RMSothebys — каждый день в 3:00 */
export const CRON_RMSOTHEBYS = '0 0 3 * * *';

/** Обновление цен в рублях — каждый день в 5:00 */
export const CRON_UPDATE_PRICES_RUB = '0 0 5 * * *';
