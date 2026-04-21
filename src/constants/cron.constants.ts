/**
 * Расписание cron-задач.
 * Формат: секунда минута час день месяц день_недели
 * Пример: '0 30 14 * * *' — каждый день в 14:30
 */

/** Парсинг OldTimerFarm — каждый день в 4:00 */
export const CRON_OLDTIMERFARM = '0 0 4 * * *';

/** Парсинг RMSothebys — каждый день в 3:00 */
export const CRON_RMSOTHEBYS = '0 0 3 * * *';

/** Парсинг HooG Selections (In showroom) — каждый день в 2:30 */
export const CRON_HOOGSELECTIONS = '0 30 2 * * *';

/** Обновление цен в рублях — каждый день в 5:00 */
export const CRON_UPDATE_PRICES_RUB = '0 0 5 * * *';

/** Парсинг постов из групп ВКонтакте — каждый день в 20:00 */
export const CRON_VK_GROUPS = '0 0 20 * * *';

// Полный цикл парсинга: OldTimerFarm -> RM Sotheby's -> обновление валют
// Запускается каждый день в 19:20
export const CRON_FULL_PARSE_CYCLE = '0 20 19 * * *';
