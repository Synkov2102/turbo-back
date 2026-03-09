import { Logger } from '@nestjs/common';
import type { Browser, Page, BrowserContext } from 'puppeteer';
import { BaseParserService } from './base-parser.service';

/**
 * Пул браузеров для переиспользования между запросами
 * Значительно ускоряет парсинг за счет избежания перезапуска браузера
 */
export class BrowserPool extends BaseParserService {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private isInitialized = false;
  private readonly maxPagesPerBrowser = 50; // Максимум страниц на один браузер
  private pagesCreated = 0;

  constructor(serviceName: string = 'BrowserPool') {
    super(serviceName);
  }

  /**
   * Инициализирует браузер и контекст (если еще не инициализированы)
   */
  async initialize(
    headless: boolean = true,
    additionalArgs: string[] = [],
  ): Promise<void> {
    if (this.isInitialized && this.browser?.isConnected()) {
      return;
    }

    const browser = await this.createBrowserWithRetry(headless, additionalArgs);
    const context = await this.createIncognitoContext(browser);

    this.browser = browser;
    this.context = context;
    this.isInitialized = true;
    this.pagesCreated = 0;

    this.logger.log('Browser pool initialized');
  }

  /**
   * Создает новую страницу из пула браузеров
   */
  async getPage(
    setupHeaders: boolean = true,
    customHeaders?: Record<string, string>,
  ): Promise<Page> {
    if (!this.isInitialized || !this.browser || !this.context) {
      throw new Error(
        'Browser pool not initialized. Call initialize() first.',
      );
    }

    // Если создано слишком много страниц, перезапускаем браузер
    // Но нужно сохранить параметры инициализации - пока просто логируем
    if (this.pagesCreated >= this.maxPagesPerBrowser) {
      this.logger.warn(
        `Reached max pages limit (${this.maxPagesPerBrowser}), consider restarting browser`,
      );
      // Пока не перезапускаем автоматически, чтобы не терять параметры
      // Можно добавить сохранение параметров инициализации в будущем
    }

    const page = await this.context.newPage();
    this.pagesCreated++;

    // Настраиваем страницу
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91 Safari/537.36',
    );

    if (setupHeaders) {
      const headers = customHeaders || {
        'accept-language': 'en-US,en;q=0.9',
      };
      await page.setExtraHTTPHeaders(headers);
    }

    return page;
  }

  /**
   * Закрывает страницу и возвращает её в пул
   */
  async releasePage(page: Page): Promise<void> {
    try {
      if (!page.isClosed()) {
        await page.close();
      }
    } catch (error) {
      this.logger.warn(
        `Error closing page: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Очищает пул браузеров
   */
  async cleanup(): Promise<void> {
    if (this.context) {
      try {
        await this.closeContext(this.context);
      } catch (error) {
        this.logger.warn(
          `Error closing context: ${(error as Error).message}`,
        );
      }
      this.context = null;
    }

    if (this.browser) {
      await this.closeBrowser(this.browser);
      this.browser = null;
    }

    this.isInitialized = false;
    this.pagesCreated = 0;
    this.logger.log('Browser pool cleaned up');
  }

  /**
   * Проверяет, инициализирован ли пул
   */
  isReady(): boolean {
    return (
      this.isInitialized &&
      this.browser !== null &&
      this.browser.isConnected() &&
      this.context !== null
    );
  }
}
