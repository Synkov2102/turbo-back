import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Page } from 'puppeteer';
import { randomUUID } from 'crypto';

export interface CaptchaSession {
  page: Page;
  viewport: { width: number; height: number };
  clicks: Array<{ x: number; y: number }>;
  createdAt: number;
}

const SESSION_TTL_MS = 10 * 60 * 1000; // 10 минут

@Injectable()
export class CaptchaSessionService {
  private readonly logger = new Logger(CaptchaSessionService.name);
  private readonly sessions = new Map<string, CaptchaSession>();

  createSession(page: Page): string {
    const sessionId = randomUUID();
    const viewport = page.viewport();
    const width = viewport?.width ?? 1280;
    const height = viewport?.height ?? 800;
    this.sessions.set(sessionId, {
      page,
      viewport: { width, height },
      clicks: [],
      createdAt: Date.now(),
    });
    this.logger.log(`Captcha session created: ${sessionId}`);
    return sessionId;
  }

  getSession(sessionId: string): CaptchaSession {
    this.cleanupExpired();
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }
    return session;
  }

  /**
   * Добавляет клик от клиента. Координаты с телефона (tapX, tapY) при размере изображения (displayWidth, displayHeight)
   * переводятся в координаты viewport страницы.
   */
  addClick(
    sessionId: string,
    tapX: number,
    tapY: number,
    displayWidth: number,
    displayHeight: number,
  ): void {
    const session = this.getSession(sessionId);
    if (displayWidth <= 0 || displayHeight <= 0) {
      session.clicks.push({ x: tapX, y: tapY });
      return;
    }
    const scaleX = session.viewport.width / displayWidth;
    const scaleY = session.viewport.height / displayHeight;
    session.clicks.push({
      x: Math.round(tapX * scaleX),
      y: Math.round(tapY * scaleY),
    });
  }

  getAndTakeClicks(sessionId: string): Array<{ x: number; y: number }> {
    const session = this.getSession(sessionId);
    const clicks = [...session.clicks];
    session.clicks.length = 0;
    return clicks;
  }

  async getScreenshot(sessionId: string): Promise<Buffer> {
    const session = this.getSession(sessionId);
    const buffer = await session.page.screenshot({ type: 'png' });
    return Buffer.from(buffer);
  }

  destroySession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.logger.log(`Captcha session destroyed: ${sessionId}`);
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.createdAt > SESSION_TTL_MS) {
        this.sessions.delete(id);
      }
    }
  }
}
