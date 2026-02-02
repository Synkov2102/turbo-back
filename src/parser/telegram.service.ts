import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly botToken: string | null = null;
  private readonly chatId: string | null = null;
  private readonly appUrl: string | null = null;

  constructor(private readonly configService: ConfigService) {
    this.botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN') ?? null;
    this.chatId = this.configService.get<string>('TELEGRAM_CHAT_ID') ?? null;
    this.appUrl = this.configService.get<string>('APP_URL') ?? null;
    if (this.botToken && this.chatId) {
      this.logger.log('Telegram notifications enabled');
    } else {
      this.logger.warn(
        'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — captcha notifications disabled',
      );
    }
  }

  isEnabled(): boolean {
    return !!(this.botToken && this.chatId);
  }

  /**
   * Отправляет уведомление о капче в Telegram со скриншотом и ссылкой на решение с телефона.
   */
  async sendCaptchaToPhone(
    sessionId: string,
    screenshotBuffer: Buffer,
  ): Promise<void> {
    if (!this.botToken || !this.chatId) {
      this.logger.warn('Telegram not configured, skipping captcha notification');
      return;
    }

    const solveUrl = this.appUrl
      ? `${this.appUrl.replace(/\/$/, '')}/captcha-solve/${sessionId}`
      : null;

    const message = solveUrl
      ? `🔐 Появилась капча. Решите её с телефона:\n${solveUrl}\n\nОткройте ссылку в браузере на телефоне и нажимайте на скриншот.`
      : `🔐 Появилась капча. Session: ${sessionId}`;

    try {
      const formData = new FormData();
      formData.append('chat_id', this.chatId);
      formData.append('caption', message);
      formData.append(
        'photo',
        new Blob([new Uint8Array(screenshotBuffer)], { type: 'image/png' }),
        'captcha.png',
      );

      const res = await fetch(
        `https://api.telegram.org/bot${this.botToken}/sendPhoto`,
        {
          method: 'POST',
          body: formData,
        },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text}`);
      }
      this.logger.log('Captcha notification sent to Telegram');
    } catch (error) {
      this.logger.error(
        `Failed to send Telegram notification: ${(error as Error).message}`,
      );
    }
  }
}
