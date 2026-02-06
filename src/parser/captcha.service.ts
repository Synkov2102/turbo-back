import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Page } from 'puppeteer';

export type CaptchaType = 'recaptcha2' | 'recaptcha3' | 'hcaptcha' | 'yandex' | 'image';

@Injectable()
export class CaptchaService {
  private readonly logger = new Logger(CaptchaService.name);

  constructor(private readonly configService: ConfigService) {
    this.logger.log('CaptchaService initialized (only detection, solving via Telegram)');
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

  // Методы решения капчи через внешний сервис (2captcha) удалены
  // Теперь используется только решение через Telegram с ручным вводом
}
