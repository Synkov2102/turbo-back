import PuppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import puppeteer from 'puppeteer';
import type { Browser, Page, BrowserContext } from 'puppeteer';
import * as fs from 'fs';

// Тип для сервиса решения капчи (чтобы избежать циклических зависимостей)
export interface CaptchaSolver {
  solveCaptcha(page: Page): Promise<boolean>;
}

/** Опции для ручного решения капчи с телефона (Telegram + страница с тапами) */
export interface ManualCaptchaOptions {
  /** Вызывается перед ожиданием; возвращает sessionId, если настроена отправка в Telegram */
  onManualCaptchaWait?: (page: Page) => Promise<string | null>;
  /** Возвращает очередь кликов с телефона для данной сессии (и очищает её) */
  getPendingClicks?: (
    sessionId: string,
  ) => Promise<Array<{ x: number; y: number }>>;
}

// Используем stealth plugin только если он включен через переменную окружения
// По умолчанию отключен из-за проблем совместимости
const USE_STEALTH_PLUGIN = process.env.USE_STEALTH_PLUGIN === 'true';

if (USE_STEALTH_PLUGIN) {
  try {
    PuppeteerExtra.use(StealthPlugin());
    console.log('[BrowserHelper] Stealth plugin enabled');
  } catch (error) {
    console.warn(
      '[BrowserHelper] Failed to enable stealth plugin:',
      (error as Error).message,
    );
  }
} else {
  console.log(
    '[BrowserHelper] Stealth plugin disabled (set USE_STEALTH_PLUGIN=true to enable)',
  );
}

// Интерфейс для прокси
export interface ProxyConfig {
  server: string;
  username?: string;
  password?: string;
}

// Парсинг прокси из строки формата: http://user:pass@host:port или http://host:port
function parseProxy(proxyString: string): ProxyConfig | null {
  if (!proxyString) return null;

  try {
    const url = new URL(proxyString);
    const config: ProxyConfig = {
      server: `${url.protocol}//${url.host}`,
    };

    if (url.username || url.password) {
      config.username = url.username || undefined;
      config.password = url.password || undefined;
    }

    return config;
  } catch {
    console.error(`[BrowserHelper] Invalid proxy format: ${proxyString}`);
    return null;
  }
}

// Получение списка прокси из переменной окружения
function getProxyList(): ProxyConfig[] {
  const proxyEnv = process.env.PROXY_LIST || process.env.PROXY;
  if (!proxyEnv) return [];

  // Поддерживаем несколько форматов:
  // 1. Один прокси: PROXY=http://user:pass@host:port
  // 2. Несколько прокси через запятую: PROXY_LIST=http://host1:port1,http://host2:port2
  const proxyStrings = proxyEnv.split(',').map((p) => p.trim());
  const proxies: ProxyConfig[] = [];

  for (const proxyString of proxyStrings) {
    const proxy = parseProxy(proxyString);
    if (proxy) {
      proxies.push(proxy);
    }
  }

  return proxies;
}

// Список прокси (загружается при первом использовании)
let proxyList: ProxyConfig[] = [];
let currentProxyIndex = 0;

/**
 * Инициализирует список прокси из переменных окружения
 */
export function initializeProxies(): void {
  proxyList = getProxyList();
  if (proxyList.length > 0) {
    console.log(`[BrowserHelper] Loaded ${proxyList.length} proxy server(s)`);
  } else {
    console.log('[BrowserHelper] No proxies configured');
  }
}

/**
 * Получает следующий прокси из списка (ротация)
 */
export function getNextProxy(): ProxyConfig | null {
  if (proxyList.length === 0) {
    return null;
  }

  const proxy = proxyList[currentProxyIndex];
  currentProxyIndex = (currentProxyIndex + 1) % proxyList.length;
  return proxy;
}

/**
 * Получает случайный прокси из списка
 */
export function getRandomProxy(): ProxyConfig | null {
  if (proxyList.length === 0) {
    return null;
  }

  return proxyList[Math.floor(Math.random() * proxyList.length)];
}

// Ротация User-Agent для обхода блокировок
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
];

/**
 * Получает случайный User-Agent
 */
export function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Случайная задержка между запросами (от 2 до 8 секунд)
 */
export function randomDelay(
  min: number = 2000,
  max: number = 8000,
): Promise<void> {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Получает базовые опции запуска Puppeteer с учетом системного Chromium (для Docker)
 */
export function getBaseLaunchOptions(
  headless: boolean = false,
  additionalArgs: string[] = [],
): Parameters<typeof puppeteer.launch>[0] {
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-crashpad-for-testing',
    '--disable-crash-reporter',
    '--disable-breakpad',
    ...additionalArgs,
  ];

  // В Docker используем обычный headless режим вместо 'new', так как 'new' может вызывать проблемы
  // Согласно https://stackoverflow.com/questions/76207925/target-createtarget-timed-out-increase-the-protocoltimeout
  const isDocker = !!process.env.PUPPETEER_EXECUTABLE_PATH;
  const options: Parameters<typeof puppeteer.launch>[0] = {
    // В Docker используем true вместо 'new' для избежания проблем с Target.createTarget timed out
    headless: headless ? (isDocker ? true : ('new' as any)) : false,
    defaultViewport: null,
    args,
    // Увеличиваем таймаут протокола для Docker (системный Chromium работает медленнее)
    // Согласно https://github.com/puppeteer/puppeteer/issues/10144 даже 240000 может быть недостаточно
    protocolTimeout: isDocker ? 300000 : 120000, // 5 минут в Docker, 2 минуты локально
  };

  // Используем системный Chromium, если указан в переменной окружения (для Docker)
  // Или пытаемся найти его автоматически
  let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (!executablePath) {
    // Пробуем стандартные пути для Chromium в Linux
    const possiblePaths = [
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
    ];
    for (const path of possiblePaths) {
      try {
        if (fs.existsSync(path)) {
          executablePath = path;
          break;
        }
      } catch {
        // Игнорируем ошибки доступа
      }
    }
  }

  if (executablePath) {
    options.executablePath = executablePath;
    console.log(`[BrowserHelper] Using system Chromium: ${executablePath}`);
  }

  return options;
}

/**
 * Создает и настраивает браузер с улучшенными настройками для обхода блокировок
 * @param headless - Запускать в headless режиме
 * @param useProxy - Использовать прокси (если доступны). По умолчанию true
 * @param proxyConfig - Конкретный прокси для использования (опционально)
 * @param incognito - Запускать браузер в режиме инкогнито. По умолчанию true
 */
export async function createBrowser(
  headless: boolean = true,
  useProxy: boolean = true,
  proxyConfig?: ProxyConfig | null,
  incognito: boolean = true,
): Promise<Browser> {
  const userAgent = getRandomUserAgent();
  console.log(
    `[BrowserHelper] Using User-Agent: ${userAgent.substring(0, 50)}...`,
  );

  const args: string[] = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-features=IsolateOrigins,site-per-process',
    '--disable-web-security',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    // Убираем --no-zygote, так как он может вызывать проблемы с Target.createTarget timed out
    // Согласно https://stackoverflow.com/questions/76207925/target-createtarget-timed-out-increase-the-protocoltimeout
    // и https://github.com/puppeteer/puppeteer/issues/10144
    // '--no-zygote',
    '--disable-gpu', // Критически важно для Docker - без этого Target.createTarget может таймаутить
    '--start-maximized',
    `--user-agent=${userAgent}`,
    // Отключаем crashpad в Docker (chrome_crashpad_handler: --database is required)
    '--disable-crashpad-for-testing',
    '--disable-crash-reporter',
    '--disable-breakpad',
    '--disable-background-networking',
    '--disable-sync',
    '--mute-audio',
    '--no-default-browser-check',
    // Отключаем DBus и дополнительные сервисы (нет в Docker контейнере)
    '--disable-software-rasterizer',
    '--disable-extensions',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=TranslateUI',
    '--disable-ipc-flooding-protection',
  ];

  // Настройка прокси
  let proxy: ProxyConfig | null = null;
  if (useProxy) {
    if (proxyConfig) {
      proxy = proxyConfig;
    } else if (proxyList.length > 0) {
      proxy = getNextProxy();
    }

    if (proxy) {
      console.log(
        `[BrowserHelper] Using proxy: ${proxy.server.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@')}`,
      );
      args.push(`--proxy-server=${proxy.server}`);
    }
  }

  // НЕ используем флаг --incognito в args, так как он не работает правильно в Puppeteer
  // Вместо этого будем использовать browser.createBrowserContext() (создает инкогнито контекст по умолчанию)

  // Тип опций запуска совместим с обоими puppeteer и puppeteer-extra
  // В Docker используем обычный headless режим вместо 'new', так как 'new' может вызывать проблемы
  // Согласно https://stackoverflow.com/questions/76207925/target-createtarget-timed-out-increase-the-protocoltimeout
  const isDocker = !!process.env.PUPPETEER_EXECUTABLE_PATH;
  const launchOptions: Parameters<typeof puppeteer.launch>[0] = {
    // В Docker используем true вместо 'new' для избежания проблем с Target.createTarget timed out
    headless: headless ? (isDocker ? true : ('new' as any)) : false,
    defaultViewport: null,
    args,
    // Увеличиваем таймаут протокола для Docker (системный Chromium работает медленнее)
    // Согласно https://github.com/puppeteer/puppeteer/issues/10144 даже 240000 может быть недостаточно
    protocolTimeout: isDocker ? 300000 : 120000, // 5 минут в Docker, 2 минуты локально
    // В Docker crashpad требует записываемый каталог для --database; задаём HOME/TMP/XDG
    env: {
      ...process.env,
      TMPDIR: '/tmp',
      TEMP: '/tmp',
      TMP: '/tmp',
      HOME: process.env.HOME || '/tmp',
      XDG_CACHE_HOME: '/tmp/.cache',
      XDG_CONFIG_HOME: '/tmp/.config',
    },
  };

  // Используем системный Chromium, если указан в переменной окружения (для Docker)
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (executablePath) {
    launchOptions.executablePath = executablePath;
    console.log(`[BrowserHelper] Using system Chromium: ${executablePath}`);
  }

  // Используем обычный puppeteer, если stealth plugin отключен
  // Это помогает избежать проблем с "Requesting main frame too early!" в puppeteer-extra
  const browser = USE_STEALTH_PLUGIN
    ? await PuppeteerExtra.launch(launchOptions)
    : await puppeteer.launch(launchOptions);

  // В Docker даем браузеру время на полную инициализацию перед созданием страниц
  // Это критически важно для избежания "Target.createTarget timed out"
  // Согласно https://www.timsanteford.com/posts/how-to-fix-puppeteer-connection-error-protocolerror-network-enable-timed-out-in-docker/
  if (isDocker) {
    console.log('[BrowserHelper] Waiting for browser to fully initialize in Docker...');
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  // Если прокси требует аутентификацию, настраиваем её
  if (proxy && proxy.username && proxy.password && browser.isConnected()) {
    try {
      const pages = await browser.pages();
      if (pages.length > 0) {
        const page = pages[0];
        await page.authenticate({
          username: proxy.username,
          password: proxy.password,
        });
      }
    } catch (error) {
      console.warn(
        '[BrowserHelper] Warning: Could not authenticate proxy:',
        (error as Error).message,
      );
    }
  }

  // Сохраняем флаг incognito в браузере для последующего использования
  (browser as any)._useIncognito = incognito;
  if (incognito) {
    console.log('[BrowserHelper] Browser will use incognito context for pages');
  }

  return browser;
}

/**
 * Создает новую страницу в режиме инкогнито (если включен)
 * @param browser - Браузер
 * @returns Новая страница в инкогнито контексте (если включено) или обычная страница
 */
export async function createPage(
  browser: Browser,
  useIncognito: boolean = true,
): Promise<Page> {
  // Проверяем, нужно ли использовать инкогнито
  // Если явно указано useIncognito = false, не используем инкогнито контекст
  const shouldUseIncognito = useIncognito;

  let page: Page | undefined;

  if (shouldUseIncognito) {
    // Создаем или получаем инкогнито контекст
    let incognitoContext = (browser as any)._incognitoContext as
      | BrowserContext
      | undefined;
    if (!incognitoContext) {
      try {
        incognitoContext = await browser.createIncognitoBrowserContext();
        (browser as any)._incognitoContext = incognitoContext;
        console.log('[BrowserHelper] Created incognito browser context');
        // Задержка после создания контекста для инициализации (увеличена для Docker)
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        console.warn('[BrowserHelper] Failed to create incognito context, using default context:', (error as Error).message);
        // Если не удалось создать инкогнито контекст, используем обычный
        page = await browser.newPage();
        if (page.isClosed()) {
          throw new Error('Page was closed immediately after creation');
        }
        await new Promise((resolve) => setTimeout(resolve, 2500));
        return page;
      }
    }
    // Создаем страницу в инкогнито контексте с retry логикой
    if (!incognitoContext) {
      throw new Error('Failed to create incognito browser context');
    }
    let retries = 3;
    while (retries > 0) {
      try {
        page = await incognitoContext.newPage();
        console.log('[BrowserHelper] Created page in incognito context');
        break;
      } catch (error) {
        const errorMessage = (error as Error).message || String(error);
        retries--;
        if (errorMessage.includes('Target.createTarget timed out') || 
            errorMessage.includes('Protocol error') ||
            errorMessage.includes('Target closed')) {
          if (retries > 0) {
            const isDocker = !!process.env.PUPPETEER_EXECUTABLE_PATH;
            const retryDelay = isDocker ? 5000 : 2000; // Больше задержка в Docker
            console.warn(`[BrowserHelper] Failed to create page in incognito context (${retries} retries left), waiting ${retryDelay}ms:`, errorMessage);
            await new Promise((resolve) => setTimeout(resolve, retryDelay));
            continue;
          }
        }
        // Если это другая ошибка или закончились попытки, пробуем обычную страницу
        console.warn('[BrowserHelper] Failed to create page in incognito context, using default context:', errorMessage);
        page = await browser.newPage();
        break;
      }
    }
  } else {
    // Создаем обычную страницу с retry логикой
    let retries = 3;
    while (retries > 0) {
      try {
        page = await browser.newPage();
        break;
      } catch (error) {
        const errorMessage = (error as Error).message || String(error);
        retries--;
        if (errorMessage.includes('Target.createTarget timed out') || 
            errorMessage.includes('Protocol error') ||
            errorMessage.includes('Target closed')) {
          if (retries > 0) {
            const isDocker = !!process.env.PUPPETEER_EXECUTABLE_PATH;
            const retryDelay = isDocker ? 5000 : 2000; // Больше задержка в Docker
            console.warn(`[BrowserHelper] Failed to create page (${retries} retries left), waiting ${retryDelay}ms:`, errorMessage);
            await new Promise((resolve) => setTimeout(resolve, retryDelay));
            continue;
          }
        }
        throw error; // Если это другая ошибка или закончились попытки, пробрасываем
      }
    }
  }

  // Проверяем, что страница была создана
  if (!page) {
    throw new Error('Failed to create page after all retries');
  }

  // TypeScript теперь знает, что page определена
  const createdPage: Page = page;

  // Убеждаемся, что страница не закрыта
  if (createdPage.isClosed()) {
    throw new Error('Page was closed immediately after creation');
  }

  // Задержка для завершения инициализации страницы и stealth plugin (если включен)
  // Это помогает избежать ошибки "Requesting main frame too early!"
  // Увеличена задержка для Docker окружения, где инициализация может быть медленнее
  // В puppeteer-extra страница может требовать дополнительного времени для инициализации
  // Для Docker с системным Chromium нужна большая задержка
  const isDocker = !!process.env.PUPPETEER_EXECUTABLE_PATH;
  const initDelay = isDocker ? 8000 : 2500; // Увеличена задержка в Docker до 8 секунд
  await new Promise((resolve) => setTimeout(resolve, initDelay));

  // Проверяем еще раз, что страница не закрыта
  if (createdPage.isClosed()) {
    throw new Error('Page was closed during initialization');
  }

  return createdPage;
}

/**
 * Настраивает страницу с улучшенными заголовками и настройками
 * @param page - Страница для настройки
 * @param skipEvaluateOnNewDocument - Пропустить evaluateOnNewDocument (для быстрых проверок статуса в Docker)
 */
export async function setupPage(page: Page, skipEvaluateOnNewDocument: boolean = false): Promise<void> {
  // Проверяем, что страница не закрыта перед началом настройки
  if (page.isClosed()) {
    throw new Error('Page is closed before setup');
  }

  const userAgent = getRandomUserAgent();

  try {
    // Устанавливаем дополнительные заголовки
    await page.setExtraHTTPHeaders({
      'accept-language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'accept-encoding': 'gzip, deflate, br',
      'sec-ch-ua':
        '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'none',
      'sec-fetch-user': '?1',
      'upgrade-insecure-requests': '1',
    });
  } catch (error) {
    if (page.isClosed()) {
      throw new Error('Page was closed during setExtraHTTPHeaders');
    }
    throw error;
  }

  // Пропускаем evaluateOnNewDocument для быстрых проверок статуса (может вызывать проблемы в Docker)
  if (skipEvaluateOnNewDocument) {
    console.log('[BrowserHelper] Skipping evaluateOnNewDocument for quick status check');
    // Добавляем задержку перед переходом (больше для Docker)
    const isDocker = !!process.env.PUPPETEER_EXECUTABLE_PATH;
    if (isDocker) {
      // В Docker системный Chromium требует больше времени для инициализации
      await new Promise((resolve) => setTimeout(resolve, 3000));
    } else {
      await randomDelay(1000, 3000);
    }
    return;
  }

  // Проверяем еще раз перед evaluateOnNewDocument
  if (page.isClosed()) {
    throw new Error('Page is closed before evaluateOnNewDocument');
  }

  // Дополнительные настройки для обхода детекции
  try {
    await page.evaluateOnNewDocument((ua: string) => {
    // Устанавливаем User-Agent через JavaScript (более надежный способ)
    Object.defineProperty(navigator, 'userAgent', {
      get: () => ua,
    });

    // Скрываем webdriver
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false,
    });

    // Добавляем chrome объект
    (window as any).chrome = {
      runtime: {},
      loadTimes: function () { },
      csi: function () { },
      app: {},
    };

    // Подделываем plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });

    // Подделываем languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['ru-RU', 'ru', 'en-US', 'en'],
    });

    // Подделываем permissions
    const originalQuery = (window.navigator as any).permissions?.query;
    (window.navigator as any).permissions = {
      query: (parameters: any) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters),
    };

    // Подделываем Notification
    const originalNotification = window.Notification;
    window.Notification = originalNotification as any;
  }, userAgent);
  } catch (error) {
    // Если страница закрылась во время evaluateOnNewDocument, это нормально в некоторых случаях
    // (например, если контекст был закрыт)
    if (page.isClosed()) {
      console.warn('[BrowserHelper] Page was closed during evaluateOnNewDocument, this may be expected in Docker');
      // Не бросаем ошибку, так как это может быть нормальным поведением в Docker
      return;
    }
    // Если это другая ошибка, пробрасываем её дальше
    throw error;
  }

  // Проверяем еще раз после evaluateOnNewDocument
  if (page.isClosed()) {
    console.warn('[BrowserHelper] Page was closed after evaluateOnNewDocument');
    return;
  }

  // Добавляем случайную задержку перед переходом
  await randomDelay(1000, 3000);
}

/**
 * Проверяет, является ли страница блокировкой IP или содержит капчу
 */
export async function isIpBlocked(page: Page): Promise<boolean> {
  return await page.evaluate(() => {
    const href = window.location.href.toLowerCase();

    // Редирект на страницу капчи Яндекса (Auto.ru → sso.passport.yandex.ru/showcaptcha)
    if (
      href.includes('passport.yandex.ru/showcaptcha') ||
      href.includes('captcha.yandex.ru') ||
      href.includes('smartcaptcha.yandex')
    ) {
      return true;
    }

    const bodyText = (document.body?.textContent || '').toLowerCase();
    const title = document.title.toLowerCase();

    // Сначала проверяем наличие основных элементов объявления
    // Если они есть, значит страница не заблокирована
    const hasCarTitle = !!document.querySelector('h1');
    const hasCarPrice =
      !!document.querySelector('[itemprop="price"]') ||
      !!document.querySelector('[data-marker="item-view/item-price"]') ||
      !!document.querySelector('[data-marker="item-view/price"]') ||
      !!document.querySelector('#sale-data-attributes'); // Auto.ru
    const hasMainContent =
      !!document.querySelector('main') ||
      !!document.querySelector('[data-marker="item-view"]') ||
      !!document.querySelector('#sale-data-attributes'); // Auto.ru

    // Если есть основные элементы объявления, страница точно не заблокирована
    if (hasCarTitle && (hasCarPrice || hasMainContent)) {
      return false;
    }

    // Проверяем специфичные признаки блокировки (более строгие проверки)
    const specificBlockedIndicators = [
      'проблема с ip',
      'проблема с ip-адресом',
      'ваш ip заблокирован',
      'ip blocked',
    ];

    // Проверяем наличие капчи Avito
    const hasAvitoCaptcha =
      !!document.querySelector('[class*="captcha"][class*="block"]') ||
      !!document.querySelector('[id*="captcha"][id*="block"]') ||
      !!document.querySelector('[data-marker*="captcha"]');

    // Проверяем наличие капчи Яндекса (для Auto.ru)
    const hasYandexCaptcha =
      !!document.querySelector('iframe[src*="captcha.yandex.ru"]') ||
      !!document.querySelector('iframe[src*="smartcaptcha.yandex.ru"]') ||
      !!document.querySelector('[class*="smart-captcha"]') ||
      !!document.querySelector('[class*="yandex-captcha"]') ||
      !!document.querySelector('[id*="smart-captcha"]') ||
      !!document.querySelector('[id*="yandex-captcha"]') ||
      !!document.querySelector('[data-captcha="yandex"]') ||
      bodyText.includes('подтвердите, что вы не робот') ||
      bodyText.includes('подтвердите что вы не робот') ||
      bodyText.includes('я не робот') ||
      bodyText.includes("i'm not a robot");

    // Проверяем наличие других элементов блокировки
    const hasBlockedElements =
      hasAvitoCaptcha ||
      hasYandexCaptcha ||
      !!document.querySelector('[class*="ip-blocked"]') ||
      !!document.querySelector('[id*="ip-blocked"]') ||
      !!document.querySelector('[class*="access-denied"]') ||
      !!document.querySelector('[id*="access-denied"]');

    // Проверяем, что в заголовке или основном тексте есть специфичные индикаторы блокировки
    const hasBlockedText = specificBlockedIndicators.some(
      (indicator) =>
        (bodyText.includes(indicator) && bodyText.length < 500) || // Короткий текст + индикатор = блокировка
        (title.includes(indicator) && title.length < 100),
    );

    // Проверяем, что страница очень короткая (признак страницы блокировки)
    const isVeryShortPage = bodyText.length < 200 && !hasMainContent;

    return hasBlockedElements || hasBlockedText || isVeryShortPage;
  });
}

/**
 * Проверяет, есть ли на странице капча (Avito или Яндекс)
 */
export async function hasCaptcha(page: Page): Promise<boolean> {
  return await page.evaluate(() => {
    const href = window.location.href.toLowerCase();

    // Страница капчи Яндекса (Auto.ru редирект на showcaptcha)
    if (
      href.includes('passport.yandex.ru/showcaptcha') ||
      href.includes('captcha.yandex.ru') ||
      href.includes('smartcaptcha.yandex')
    ) {
      return true;
    }

    const bodyText = (document.body?.textContent || '').toLowerCase();

    // Проверяем капчу Avito
    const hasAvitoCaptcha =
      !!document.querySelector('[class*="captcha"][class*="block"]') ||
      !!document.querySelector('[id*="captcha"][id*="block"]') ||
      !!document.querySelector('[data-marker*="captcha"]');

    // Проверяем капчу Яндекса (для Auto.ru)
    const hasYandexCaptcha =
      !!document.querySelector('iframe[src*="captcha.yandex.ru"]') ||
      !!document.querySelector('iframe[src*="smartcaptcha.yandex.ru"]') ||
      !!document.querySelector('[class*="smart-captcha"]') ||
      !!document.querySelector('[class*="yandex-captcha"]') ||
      !!document.querySelector('[id*="smart-captcha"]') ||
      !!document.querySelector('[id*="yandex-captcha"]') ||
      !!document.querySelector('[data-captcha="yandex"]') ||
      bodyText.includes('подтвердите, что вы не робот') ||
      bodyText.includes('подтвердите что вы не робот') ||
      bodyText.includes('я не робот') ||
      bodyText.includes("i'm not a robot");

    return hasAvitoCaptcha || hasYandexCaptcha;
  });
}

/**
 * Ожидает решения капчи пользователем
 * @param page Страница с капчей
 * @param maxWaitTime Максимальное время ожидания в миллисекундах (по умолчанию 5 минут)
 * @returns true если капча решена, false если время истекло
 */
export async function waitForCaptchaSolution(
  page: Page,
  maxWaitTime: number = 5 * 60 * 1000, // 5 минут
): Promise<boolean> {
  console.log(
    `[BrowserHelper] Waiting for captcha solution (max ${maxWaitTime / 1000}s)...`,
  );

  const startTime = Date.now();
  const checkInterval = 2000; // Проверяем каждые 2 секунды

  while (Date.now() - startTime < maxWaitTime) {
    const hasCaptchaNow = await hasCaptcha(page);
    const isBlocked = await isIpBlocked(page);

    // Если капчи больше нет и страница не заблокирована, значит она решена
    if (!hasCaptchaNow && !isBlocked) {
      console.log('[BrowserHelper] Captcha appears to be solved!');
      // Даем немного времени на загрузку контента после решения капчи
      await randomDelay(2000, 3000);
      return true;
    }

    // Если капча все еще есть, ждем
    if (hasCaptchaNow) {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      console.log(
        `[BrowserHelper] Captcha still present, waiting... (${elapsed}s elapsed)`,
      );
    }

    await randomDelay(checkInterval, checkInterval);
  }

  console.warn(
    `[BrowserHelper] Timeout waiting for captcha solution (${maxWaitTime / 1000}s)`,
  );
  return false;
}

/**
 * Ожидает решения капчи с учётом кликов с телефона (очередь из API).
 */
export async function waitForCaptchaSolutionWithRemote(
  page: Page,
  sessionId: string,
  getPendingClicks: (
    sessionId: string,
  ) => Promise<Array<{ x: number; y: number }>>,
  maxWaitTime: number = 5 * 60 * 1000,
): Promise<boolean> {
  const startTime = Date.now();
  const checkInterval = 2000;

  while (Date.now() - startTime < maxWaitTime) {
    const clicks = await getPendingClicks(sessionId);
    for (const c of clicks) {
      try {
        await page.mouse.click(c.x, c.y);
        console.log(`[BrowserHelper] Applied click from phone: ${c.x}, ${c.y}`);
        await randomDelay(500, 1000);
      } catch (err) {
        console.warn(`[BrowserHelper] Click failed: ${(err as Error).message}`);
      }
    }

    const hasCaptchaNow = await hasCaptcha(page);
    const isBlocked = await isIpBlocked(page);
    if (!hasCaptchaNow && !isBlocked) {
      console.log('[BrowserHelper] Captcha solved (remote)!');
      await randomDelay(2000, 3000);
      return true;
    }

    await randomDelay(checkInterval, checkInterval);
  }

  console.warn(
    `[BrowserHelper] Timeout waiting for remote captcha solution (${maxWaitTime / 1000}s)`,
  );
  return false;
}

/**
 * Переходит на страницу с обработкой блокировок и retry
 * @param captchaSolver Опциональный сервис для автоматического решения капчи
 * @param manualCaptcha Опции для ручного решения с телефона (Telegram + тапы)
 */
export async function navigateWithRetry(
  page: Page,
  url: string,
  maxRetries: number = 3,
  captchaSolver?: CaptchaSolver,
  manualCaptcha?: ManualCaptchaOptions,
): Promise<boolean> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(
        `[BrowserHelper] Navigating to ${url} (attempt ${attempt}/${maxRetries})...`,
      );

      // Проверяем, что страница не закрыта
      if (page.isClosed()) {
        throw new Error('Page is closed');
      }

      // Добавляем случайную задержку перед запросом
      if (attempt > 1) {
        const delay = attempt * 5000; // Увеличиваем задержку с каждой попыткой
        console.log(`[BrowserHelper] Waiting ${delay}ms before retry...`);
        await randomDelay(delay, delay + 2000);
      }

      // В Docker даем фиксированную задержку перед навигацией
      // Это помогает избежать ошибки "Requesting main frame too early!"
      const isDocker = !!process.env.PUPPETEER_EXECUTABLE_PATH;
      if (isDocker) {
        // В Docker системный Chromium требует больше времени для инициализации страницы
        // Фиксированная задержка более надежна, чем проверка готовности
        await new Promise((resolve) => setTimeout(resolve, 3000));
      } else {
        // Локально можно использовать более короткую задержку
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // Проверяем, что страница и браузер все еще подключены перед навигацией
      try {
        const browser = page.browser();
        if (page.isClosed() || !browser.isConnected()) {
          throw new Error('Page or browser closed before navigation');
        }
      } catch (browserError) {
        // Если не удалось получить браузер, страница может быть закрыта
        if (page.isClosed()) {
          throw new Error('Page is closed before navigation');
        }
        // Игнорируем другие ошибки получения браузера
      }

      // В Docker используем более мягкие параметры для навигации
      // Используем 'load' вместо 'domcontentloaded' для большей надежности в Docker
      // Оборачиваем в try-catch для обработки "Requesting main frame too early!"
      try {
        await page.goto(url, {
          waitUntil: isDocker ? 'load' : 'networkidle2',
          timeout: 60000,
        });
      } catch (gotoError) {
        const errorMessage = (gotoError as Error).message || String(gotoError);
        // Если это ошибка "Requesting main frame too early!" (известная проблема в Puppeteer 20.6.0+)
        // См. https://github.com/puppeteer/puppeteer/issues/11246
        if (errorMessage.includes('Requesting main frame too early') || 
            errorMessage.includes('Session closed') ||
            errorMessage.includes('Protocol error')) {
          console.warn(`[BrowserHelper] Got "${errorMessage}" error on attempt ${attempt}`);
          if (attempt < maxRetries) {
            // Увеличиваем задержку перед следующей попыткой для этой конкретной ошибки
            const extraDelay = isDocker ? 5000 : 2000;
            console.log(`[BrowserHelper] Waiting additional ${extraDelay}ms before retry...`);
            await new Promise((resolve) => setTimeout(resolve, extraDelay));
            // Пробрасываем ошибку, чтобы цикл for сделал retry
            throw gotoError;
          }
        }
        throw gotoError;
      }

      // Ждем загрузки страницы
      await randomDelay(2000, 4000);

      // Проверяем, не заблокирован ли IP
      const blocked = await isIpBlocked(page);
      if (blocked) {
        console.warn(
          `[BrowserHelper] IP blocked or captcha detected on attempt ${attempt}. Current URL: ${page.url()}`,
        );

        // Проверяем, есть ли капча (Avito или Яндекс)
        const captchaPresent = await hasCaptcha(page);
        if (captchaPresent) {
          let captchaSolved = false;

          // Пробуем автоматически решить капчу, если есть сервис
          if (captchaSolver) {
            console.log(
              '[BrowserHelper] Captcha detected. Attempting automatic solution...',
            );
            try {
              captchaSolved = await captchaSolver.solveCaptcha(page);
              if (captchaSolved) {
                console.log(
                  '[BrowserHelper] Captcha solved automatically! Waiting for page to process...',
                );
                await randomDelay(3000, 5000);
                // Проверяем, что капча действительно решена
                const stillHasCaptcha = await hasCaptcha(page);
                if (stillHasCaptcha) {
                  console.warn(
                    '[BrowserHelper] Captcha still present after automatic solution, falling back to manual',
                  );
                  captchaSolved = false;
                }
              }
            } catch (error) {
              console.error(
                `[BrowserHelper] Error solving captcha automatically: ${(error as Error).message}`,
              );
              captchaSolved = false;
            }
          }

          // Если автоматическое решение не сработало — уведомление в Telegram и ожидание с телефона или в браузере
          if (!captchaSolved) {
            const sessionId =
              manualCaptcha?.onManualCaptchaWait != null
                ? await manualCaptcha.onManualCaptchaWait(page)
                : null;

            if (sessionId != null && manualCaptcha?.getPendingClicks != null) {
              console.log(
                '[BrowserHelper] Captcha sent to phone. Waiting for taps...',
              );
              captchaSolved = await waitForCaptchaSolutionWithRemote(
                page,
                sessionId,
                manualCaptcha.getPendingClicks,
                5 * 60 * 1000,
              );
            } else {
              console.log(
                '[BrowserHelper] Captcha detected. Waiting for manual solution...',
              );
              captchaSolved = await waitForCaptchaSolution(page, 5 * 60 * 1000);
            }
          }

          if (captchaSolved) {
            console.log(
              '[BrowserHelper] Captcha solved! Continuing with page processing...',
            );
            // Проверяем еще раз, что страница загрузилась корректно
            await randomDelay(2000, 3000);
            const stillBlocked = await isIpBlocked(page);
            if (!stillBlocked) {
              console.log(
                '[BrowserHelper] Successfully loaded page after captcha',
              );
              return true;
            } else {
              console.warn(
                '[BrowserHelper] Page still blocked after captcha solution',
              );
              if (attempt < maxRetries) {
                continue;
              } else {
                return false;
              }
            }
          } else {
            console.error(
              '[BrowserHelper] Captcha not solved within timeout period',
            );
            if (attempt < maxRetries) {
              console.log(
                `[BrowserHelper] Retrying in ${attempt * 10} seconds...`,
              );
              await randomDelay(attempt * 10000, attempt * 10000 + 5000);
              continue;
            } else {
              return false;
            }
          }
        } else {
          // Блокировка без капчи - обычная IP блокировка
          if (attempt < maxRetries) {
            console.log(
              `[BrowserHelper] Retrying in ${attempt * 10} seconds...`,
            );
            await randomDelay(attempt * 10000, attempt * 10000 + 5000);
            continue;
          } else {
            console.error(
              '[BrowserHelper] Max retries reached. IP still blocked.',
            );
            return false;
          }
        }
      }

      console.log(`[BrowserHelper] Successfully loaded page: ${page.url()}`);
      return true;
    } catch (error) {
      console.error(
        `[BrowserHelper] Error on attempt ${attempt}:`,
        (error as Error).message,
      );
      if (attempt < maxRetries) {
        const delay = attempt * 5000;
        console.log(`[BrowserHelper] Retrying in ${delay}ms...`);
        await randomDelay(delay, delay + 2000);
      } else {
        console.error('[BrowserHelper] Max retries reached.');
        return false;
      }
    }
  }

  return false;
}

/**
 * Нормализует URL Avito, удаляя параметры отслеживания
 * Параметр `context` содержит информацию об источнике трафика и может использоваться для детекции ботов
 * @param url - URL объявления
 * @returns Очищенный URL без параметров отслеживания
 */
export function normalizeAvitoUrl(url: string): string {
  try {
    const urlObj = new URL(url);

    // Удаляем параметры отслеживания
    const trackingParams = [
      'context', // Информация об источнике трафика (base64-encoded)
      'utm_source', // UTM метки
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'ref', // Реферер
      'from', // Источник
      'src', // Альтернативный источник
      'r', // Короткий параметр реферера
      'af', // Attribution framework
    ];

    trackingParams.forEach((param) => {
      urlObj.searchParams.delete(param);
    });

    return urlObj.toString();
  } catch (error) {
    console.warn(`[BrowserHelper] Failed to normalize URL: ${url}`, error);
    return url; // Возвращаем оригинальный URL в случае ошибки
  }
}

/**
 * Декодирует параметр context из URL Avito (для отладки)
 * @param contextString - Значение параметра context
 * @returns Декодированные данные или null
 */
export function decodeAvitoContext(contextString: string): any {
  try {
    // Параметр context обычно содержит base64-encoded JSON
    const decoded = Buffer.from(contextString, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch {
    try {
      // Иногда это может быть просто base64 строка
      return Buffer.from(contextString, 'base64').toString('utf-8');
    } catch {
      return null;
    }
  }
}

// Инициализируем прокси при загрузке модуля
initializeProxies();
