import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Solver } from '@2captcha/captcha-solver';
import type { Page } from 'puppeteer';

export type CaptchaType = 'recaptcha2' | 'recaptcha3' | 'hcaptcha' | 'yandex' | 'image';

@Injectable()
export class CaptchaService {
  private readonly logger = new Logger(CaptchaService.name);
  private solver: Solver | null = null;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('CAPTCHA_API_KEY');
    if (apiKey) {
      this.solver = new Solver(apiKey);
      this.logger.log('CaptchaService initialized with API key');
    } else {
      this.logger.warn('CAPTCHA_API_KEY not set, captcha solving disabled');
    }
  }

  /**
   * Определяет тип капчи на странице
   */
  async detectCaptchaType(page: Page): Promise<CaptchaType | null> {
    return await page.evaluate(() => {
      const href = window.location.href;

      // Страница капчи Яндекса (редирект Auto.ru на sso.passport.yandex.ru/showcaptcha)
      if (
        href.includes('passport.yandex.ru/showcaptcha') ||
        href.includes('captcha.yandex.ru') ||
        href.includes('smartcaptcha.yandex')
      ) {
        return 'yandex';
      }

      // reCAPTCHA v2
      if (
        document.querySelector('iframe[src*="recaptcha"]') ||
        document.querySelector('[data-sitekey]') ||
        document.querySelector('.g-recaptcha')
      ) {
        return 'recaptcha2';
      }

      // reCAPTCHA v3
      if (
        document.querySelector('script[src*="recaptcha/api.js?render"]') ||
        document.querySelector('[data-callback*="recaptcha"]')
      ) {
        return 'recaptcha3';
      }

      // hCaptcha
      if (
        document.querySelector('iframe[src*="hcaptcha.com"]') ||
        document.querySelector('[data-sitekey]')?.getAttribute('data-sitekey')?.includes('hcaptcha')
      ) {
        return 'hcaptcha';
      }

      // Яндекс SmartCaptcha
      if (
        document.querySelector('iframe[src*="captcha.yandex.ru"]') ||
        document.querySelector('iframe[src*="smartcaptcha.yandex.ru"]') ||
        document.querySelector('[class*="smart-captcha"]') ||
        document.querySelector('[data-captcha="yandex"]')
      ) {
        return 'yandex';
      }

      // Обычная капча с изображением
      if (
        document.querySelector('img[src*="captcha"]') ||
        document.querySelector('[class*="captcha"] img')
      ) {
        return 'image';
      }

      return null;
    });
  }

  /**
   * Решает reCAPTCHA v2
   */
  async solveRecaptcha2(page: Page, siteKey: string): Promise<string | null> {
    if (!this.solver) {
      this.logger.warn('Captcha solver not initialized');
      return null;
    }

    try {
      this.logger.log(`Solving reCAPTCHA v2 for siteKey: ${siteKey.substring(0, 20)}...`);
      const pageUrl = page.url();

      const result = await this.solver.recaptcha({
        pageurl: pageUrl,
        googlekey: siteKey,
      });

      this.logger.log('reCAPTCHA v2 solved successfully');
      return result.data;
    } catch (error) {
      this.logger.error(`Error solving reCAPTCHA v2: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Решает Яндекс SmartCaptcha
   */
  async solveYandexCaptcha(page: Page, siteKey: string): Promise<string | null> {
    if (!this.solver) {
      this.logger.warn('Captcha solver not initialized');
      return null;
    }

    try {
      this.logger.log(`Solving Yandex SmartCaptcha for siteKey: ${siteKey.substring(0, 20)}...`);
      const pageUrl = page.url();

      const result = await this.solver.yandexSmart({
        pageurl: pageUrl,
        sitekey: siteKey,
      });

      this.logger.log('Yandex SmartCaptcha solved successfully');
      return result.data;
    } catch (error) {
      this.logger.error(`Error solving Yandex captcha: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Решает hCaptcha
   */
  async solveHcaptcha(page: Page, siteKey: string): Promise<string | null> {
    if (!this.solver) {
      this.logger.warn('Captcha solver not initialized');
      return null;
    }

    try {
      this.logger.log(`Solving hCaptcha for siteKey: ${siteKey.substring(0, 20)}...`);
      const pageUrl = page.url();

      const result = await this.solver.hcaptcha({
        pageurl: pageUrl,
        sitekey: siteKey,
      });

      this.logger.log('hCaptcha solved successfully');
      return result.data;
    } catch (error) {
      this.logger.error(`Error solving hCaptcha: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Извлекает sitekey со страницы
   */
  async extractSiteKey(page: Page, captchaType: CaptchaType): Promise<string | null> {
    return await page.evaluate((type) => {
      if (type === 'recaptcha2' || type === 'recaptcha3') {
        // reCAPTCHA sitekey
        const sitekeyElement = document.querySelector('[data-sitekey]');
        if (sitekeyElement) {
          return sitekeyElement.getAttribute('data-sitekey');
        }

        // Ищем в iframe
        const iframe = document.querySelector('iframe[src*="recaptcha"]');
        if (iframe) {
          const src = iframe.getAttribute('src') || '';
          const match = src.match(/[?&]k=([^&]+)/);
          if (match) return match[1];
        }

        // Ищем в скриптах
        const scripts = document.querySelectorAll('script');
        for (const script of scripts) {
          const text = script.textContent || '';
          const match = text.match(/sitekey['"]?\s*[:=]\s*['"]([^'"]+)['"]/);
          if (match) return match[1];
        }
      }

      if (type === 'yandex') {
        // Страница "I'm not a robot" (checkbox) — ключ в action формы checkcaptcha?key=...
        const form = document.querySelector('form[action*="checkcaptcha"]');
        if (form) {
          const action = form.getAttribute('action') || '';
          const keyMatch = action.match(/[?&]key=([^&]+)/);
          if (keyMatch) return decodeURIComponent(keyMatch[1]);
        }

        // window.__SSR_DATA__.captchaKey (страница checkbox Yandex)
        try {
          const ssr = (window as any).__SSR_DATA__;
          if (ssr && ssr.captchaKey && ssr.captchaKey.length > 10) return ssr.captchaKey;
        } catch {
          /* ignore */
        }

        // Яндекс SmartCaptcha: data-sitekey (клиентский ключ, может быть ysc1_... или другой формат)
        const sitekeyEl = document.querySelector('[data-sitekey]');
        if (sitekeyEl) {
          const v = sitekeyEl.getAttribute('data-sitekey');
          if (v && v.length > 10) return v;
        }

        // data-smart-token иногда используется как атрибут с ключом
        const smartTokenEl = document.querySelector('[data-smart-token]');
        if (smartTokenEl) {
          const v = smartTokenEl.getAttribute('data-smart-token');
          if (v && v.length > 10) return v;
        }

        // iframe SmartCaptcha или passport showcaptcha — ключ в src
        const iframe =
          document.querySelector('iframe[src*="smartcaptcha.yandex.ru"]') ||
          document.querySelector('iframe[src*="captcha.yandex.ru"]');
        if (iframe) {
          const src = iframe.getAttribute('src') || '';
          const match =
            src.match(/sitekey=([^&]+)/) ||
            src.match(/[?&]key=([^&]+)/) ||
            src.match(/(ysc1_[A-Za-z0-9_-]+)/);
          if (match) return decodeURIComponent(match[1]).replace(/\+/g, ' ');
        }

        // Страница passport.yandex.ru/showcaptcha — ключ в URL
        try {
          const params = new URLSearchParams(window.location.search);
          const key = params.get('key') || params.get('sitekey') || params.get('k');
          if (key) return key;
        } catch {
          /* ignore */
        }

        // captchaKey из __SSR_DATA__ или из текста скриптов (страница "I'm not a robot")
        const html = document.documentElement.innerHTML;
        const captchaKeyMatch = html.match(/captchaKey\s*:\s*["']([^"']+)["']/);
        if (captchaKeyMatch && captchaKeyMatch[1].length > 20) return captchaKeyMatch[1];

        // Клиентский ключ Yandex SmartCaptcha (ysc1_...) или sitekey в скриптах/HTML
        const yscMatch = html.match(/(ysc1_[A-Za-z0-9_-]{20,})/);
        if (yscMatch) return yscMatch[1];

        const scripts = document.querySelectorAll('script');
        for (const script of scripts) {
          const text = script.textContent || '';
          const match =
            text.match(/sitekey['"]?\s*[:=]\s*['"]([^'"]+)['"]/) ||
            text.match(/client_key['"]?\s*[:=]\s*['"]([^'"]+)['"]/) ||
            text.match(/key['"]?\s*[:=]\s*['"]([^'"]+)['"]/) ||
            text.match(/(ysc1_[A-Za-z0-9_-]+)/);
          if (match) return match[1];
        }
      }

      if (type === 'hcaptcha') {
        const sitekeyElement = document.querySelector('[data-sitekey]');
        if (sitekeyElement) {
          return sitekeyElement.getAttribute('data-sitekey');
        }
      }

      return null;
    }, captchaType);
  }

  /**
   * Вводит токен решения капчи на страницу
   */
  async submitCaptchaToken(
    page: Page,
    captchaType: CaptchaType,
    token: string,
  ): Promise<boolean> {
    try {
      if (captchaType === 'recaptcha2' || captchaType === 'recaptcha3') {
        // reCAPTCHA
        await page.evaluate((captchaToken) => {
          const textarea = document.querySelector('textarea[name="g-recaptcha-response"]');
          if (textarea) {
            (textarea as HTMLTextAreaElement).value = captchaToken;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
          }

          // Также пробуем через callback
          const callback = document.querySelector('[data-callback]')?.getAttribute('data-callback');
          if (callback && (window as any)[callback]) {
            (window as any)[callback](captchaToken);
          }
        }, token);

        // Ждем немного для обработки токена
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return true;
      }

      if (captchaType === 'yandex') {
        // Яндекс SmartCaptcha
        await page.evaluate((captchaToken) => {
          const input = document.querySelector('input[name="smart-token"]');
          if (input) {
            (input as HTMLInputElement).value = captchaToken;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }

          // Пробуем через callback
          const callback = document.querySelector('[data-callback]')?.getAttribute('data-callback');
          if (callback && (window as any)[callback]) {
            (window as any)[callback](captchaToken);
          }
        }, token);

        await new Promise((resolve) => setTimeout(resolve, 2000));
        return true;
      }

      if (captchaType === 'hcaptcha') {
        // hCaptcha
        await page.evaluate((captchaToken) => {
          const textarea = document.querySelector('textarea[name="h-captcha-response"]');
          if (textarea) {
            (textarea as HTMLTextAreaElement).value = captchaToken;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }, token);

        await new Promise((resolve) => setTimeout(resolve, 2000));
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error(`Error submitting captcha token: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Автоматически решает капчу на странице
   */
  async solveCaptcha(page: Page): Promise<boolean> {
    if (!this.solver) {
      this.logger.warn('Captcha solver not initialized, skipping automatic solving');
      return false;
    }

    try {
      this.logger.log('Detecting captcha type...');
      const captchaType = await this.detectCaptchaType(page);

      if (!captchaType) {
        this.logger.log('No captcha detected');
        return false;
      }

      this.logger.log(`Detected captcha type: ${captchaType}`);

      // Извлекаем sitekey
      const siteKey = await this.extractSiteKey(page, captchaType);
      if (!siteKey) {
        this.logger.warn('Could not extract sitekey from page');
        return false;
      }

      this.logger.log(`Extracted sitekey: ${siteKey.substring(0, 20)}...`);

      // Решаем капчу в зависимости от типа
      let token: string | null = null;

      if (captchaType === 'recaptcha2' || captchaType === 'recaptcha3') {
        token = await this.solveRecaptcha2(page, siteKey);
      } else if (captchaType === 'yandex') {
        token = await this.solveYandexCaptcha(page, siteKey);
      } else if (captchaType === 'hcaptcha') {
        token = await this.solveHcaptcha(page, siteKey);
      } else {
        this.logger.warn(`Unsupported captcha type: ${captchaType}`);
        return false;
      }

      if (!token) {
        this.logger.error('Failed to solve captcha');
        return false;
      }

      // Вводим токен на страницу
      const submitted = await this.submitCaptchaToken(page, captchaType, token);
      if (!submitted) {
        this.logger.error('Failed to submit captcha token');
        return false;
      }

      this.logger.log('Captcha solved and submitted successfully');
      return true;
    } catch (error) {
      this.logger.error(`Error solving captcha: ${(error as Error).message}`);
      return false;
    }
  }
}
