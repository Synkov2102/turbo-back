import { Logger } from '@nestjs/common';
import PuppeteerExtra from 'puppeteer-extra';
import type { Browser, Page, BrowserContext } from 'puppeteer';
import { getBaseLaunchOptions, DEFAULT_HEADLESS } from './browser-helper';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91 Safari/537.36';

/**
 * Базовый класс для парсеров с общей логикой работы с браузером
 */
export abstract class BaseParserService {
  protected readonly logger: Logger;
  protected readonly isDocker: boolean;

  constructor(serviceName: string) {
    this.logger = new Logger(serviceName);
    this.isDocker =
      !!process.env.PUPPETEER_EXECUTABLE_PATH ||
      process.env.NODE_ENV === 'production';
  }

  /**
   * Создает и настраивает браузер с retry логикой для Docker
   */
  protected async createBrowserWithRetry(
    headless: boolean = DEFAULT_HEADLESS,
    additionalArgs: string[] = [],
  ): Promise<Browser> {
    const useHeadless = this.isDocker ? DEFAULT_HEADLESS : headless;
    const browser = await PuppeteerExtra.launch(
      getBaseLaunchOptions(useHeadless, additionalArgs),
    );

    // В Docker даем браузеру время на полную инициализацию
    if (this.isDocker) {
      this.logger.log('Ожидание полной инициализации браузера в Docker...');
      await new Promise((resolve) => setTimeout(resolve, 5000));

      if (!browser.isConnected()) {
        throw new Error('Browser disconnected after launch');
      }
    }

    return browser;
  }

  /**
   * Создает incognito контекст с retry логикой
   */
  protected async createIncognitoContext(
    browser: Browser,
  ): Promise<BrowserContext> {
    let retries = 3;
    while (retries > 0) {
      try {
        const context = await browser.createIncognitoBrowserContext();

        // Дополнительная задержка перед созданием страницы в Docker
        if (this.isDocker) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }

        return context;
      } catch (error) {
        retries--;
        if (retries === 0) {
          throw error;
        }
        this.logger.warn(
          `Failed to create context, retrying... (${retries} retries left)`,
        );
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    throw new Error('Failed to create context after retries');
  }

  /**
   * Создает страницу с retry логикой и настройками
   * @param context Контекст браузера
   * @param setupHeaders Настраивать ли заголовки по умолчанию
   * @param customHeaders Кастомные заголовки (если setupHeaders = true, они переопределят дефолтные)
   */
  protected async createPage(
    context: BrowserContext,
    setupHeaders: boolean = true,
    customHeaders?: Record<string, string>,
  ): Promise<Page> {
    let retries = 3;
    let page: Page | undefined;

    while (retries > 0) {
      try {
        page = await context.newPage();
        if (!page.isClosed()) {
          break;
        }
      } catch (error) {
        retries--;
        if (retries === 0) {
          throw error;
        }
        this.logger.warn(
          `Failed to create page, retrying... (${retries} retries left)`,
        );
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    if (!page || page.isClosed()) {
      throw new Error('Failed to create page after retries');
    }

    // Настраиваем страницу
    await page.setUserAgent(USER_AGENT);

    if (setupHeaders) {
      const headers = customHeaders || {
        'accept-language': 'en-US,en;q=0.9',
      };
      await page.setExtraHTTPHeaders(headers);
    }

    return page;
  }

  /**
   * Создает браузер, контекст и страницу с правильной настройкой
   * @param headless Запускать в headless режиме
   * @param additionalArgs Дополнительные аргументы для браузера
   * @param setupHeaders Настраивать ли заголовки по умолчанию
   * @param customHeaders Кастомные заголовки (если setupHeaders = true)
   */
  protected async setupBrowserAndPage(
    headless: boolean = DEFAULT_HEADLESS,
    additionalArgs: string[] = [],
    setupHeaders: boolean = true,
    customHeaders?: Record<string, string>,
  ): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
    const browser = await this.createBrowserWithRetry(headless, additionalArgs);
    const context = await this.createIncognitoContext(browser);
    const page = await this.createPage(context, setupHeaders, customHeaders);

    return { browser, context, page };
  }

  /**
   * Безопасно закрывает контекст браузера
   */
  protected async closeContext(context?: BrowserContext): Promise<void> {
    if (context) {
      try {
        await context.close();
      } catch (error) {
        this.logger.warn(`Error closing context: ${(error as Error).message}`);
      }
    }
  }

  /**
   * Безопасно закрывает браузер (автоматически закроет все контексты)
   */
  protected async closeBrowser(browser?: Browser): Promise<void> {
    if (browser && browser.isConnected()) {
      try {
        await browser.close();
      } catch (error) {
        this.logger.warn(`Error closing browser: ${(error as Error).message}`);
      }
    }
  }

  /**
   * Безопасно закрывает контекст и браузер
   */
  protected async closeBrowserAndContext(
    browser?: Browser,
    context?: BrowserContext,
  ): Promise<void> {
    // Сначала закрываем контекст (если указан)
    if (context) {
      try {
        await context.close();
      } catch (error) {
        this.logger.warn(`Error closing context: ${(error as Error).message}`);
      }
    }
    // Затем закрываем браузер (закроет все оставшиеся контексты)
    await this.closeBrowser(browser);
  }
}
