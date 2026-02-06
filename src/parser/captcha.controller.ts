import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Res,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { CaptchaSessionService } from './captcha-session.service';

@Controller()
export class CaptchaController {
  constructor(
    private readonly captchaSessionService: CaptchaSessionService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Страница для решения капчи с телефона: показывается скриншот, тап отправляет клик в браузер на сервере.
   */
  @Get('captcha-solve/:sessionId')
  async captchaSolvePage(
    @Param('sessionId') sessionId: string,
    @Res() res: Response,
  ): Promise<void> {
    try {
      this.captchaSessionService.getSession(sessionId);
    } catch {
      throw new NotFoundException('Сессия не найдена или истекла');
    }

    // Получаем базовый URL приложения для использования полных путей
    const appUrl =
      this.configService.get<string>('APP_URL') ||
      (process.env.NODE_ENV === 'production'
        ? `https://${res.req.headers.host}`
        : `http://${res.req.headers.host}`);
    const baseUrl = appUrl.replace(/\/$/, '');

    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Решить капчу</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; margin: 0; padding: 16px; background: #1a1a1a; color: #eee; min-height: 100vh; }
    h1 { font-size: 1.25rem; margin-bottom: 8px; }
    p { color: #999; font-size: 0.9rem; margin-bottom: 16px; }
    #imgWrap { max-width: 100%; overflow: auto; -webkit-overflow-scrolling: touch; }
    #captchaImg { display: block; max-width: 100%; height: auto; cursor: pointer; border: 2px solid #444; border-radius: 8px; }
    #captchaImg:active { opacity: 0.9; }
    #status { margin-top: 12px; font-size: 0.85rem; color: #6a6; }
    .error { color: #f66; }
  </style>
</head>
<body>
  <h1>Решите капчу</h1>
  <p>Нажимайте на скриншот в тех местах, где нужно кликнуть в капче (например, «Я не робот»).</p>
  <div id="imgWrap"><img id="captchaImg" alt="Капча" /></div>
  <div id="status">Загрузка…</div>
  <script>
    const sessionId = ${JSON.stringify(sessionId)};
    const baseUrl = ${JSON.stringify(baseUrl)};
    const img = document.getElementById('captchaImg');
    const status = document.getElementById('status');

    function loadScreenshot() {
      fetch(baseUrl + '/captcha-session/' + sessionId + '/screenshot')
        .then(r => { if (!r.ok) throw new Error(r.status); return r.blob(); })
        .then(blob => {
          img.src = URL.createObjectURL(blob);
          img.onload = () => { status.textContent = 'Нажимайте на изображение.'; };
        })
        .catch(() => { status.textContent = 'Ошибка загрузки. Сессия истекла?'; status.classList.add('error'); });
    }

    img.addEventListener('click', function(e) {
      const rect = img.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const displayWidth = rect.width;
      const displayHeight = rect.height;
      status.textContent = 'Отправка клика…';
      fetch(baseUrl + '/captcha-session/' + sessionId + '/click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x, y, displayWidth, displayHeight })
      })
        .then(r => { if (!r.ok) throw new Error(); status.textContent = 'Клик отправлен. Если капча решена — можно закрыть страницу.'; loadScreenshot(); })
        .catch(() => { status.textContent = 'Ошибка отправки.'; status.classList.add('error'); });
    });

    loadScreenshot();
    setInterval(loadScreenshot, 5000);
  </script>
</body>
</html>`;

    res.contentType('text/html').send(html);
  }

  @Get('captcha-session/:id/screenshot')
  async getScreenshot(
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const session = this.captchaSessionService.getSession(id);
      const buffer = await this.captchaSessionService.getScreenshot(id);
      res.setHeader('X-Viewport-Width', String(session.viewport.width));
      res.setHeader('X-Viewport-Height', String(session.viewport.height));
      res.contentType('image/png').send(buffer);
    } catch {
      throw new NotFoundException('Сессия не найдена');
    }
  }

  @Post('captcha-session/:id/click')
  async addClick(
    @Param('id') id: string,
    @Body()
    body: {
      x: number;
      y: number;
      displayWidth?: number;
      displayHeight?: number;
    },
  ): Promise<{ ok: boolean }> {
    const displayWidth = body.displayWidth ?? 0;
    const displayHeight = body.displayHeight ?? 0;
    this.captchaSessionService.addClick(
      id,
      body.x,
      body.y,
      displayWidth,
      displayHeight,
    );
    return { ok: true };
  }
}
