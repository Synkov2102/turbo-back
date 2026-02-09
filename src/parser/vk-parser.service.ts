import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { Post, PostDocument } from '../schemas/post.schema';
import { ParseVkGroupDto } from './dto/parse-vk-group.dto';

interface VkPost {
  id: number;
  date: number;
  text: string;
  attachments?: Array<{
    type: string;
    photo?: {
      sizes: Array<{
        type: string;
        url: string;
      }>;
    };
  }>;
}

interface VkWallResponse {
  response: {
    count: number;
    items: VkPost[];
    groups?: Array<{
      id: number;
      name: string;
      screen_name: string;
    }>;
  };
}

interface VkErrorResponse {
  error: {
    error_code: number;
    error_msg: string;
  };
}

@Injectable()
export class VkParserService {
  private readonly logger = new Logger(VkParserService.name);
  private readonly vkApiUrl = 'https://api.vk.com/method';
  private readonly vkApiVersion = '5.131';
  private readonly defaultPostCount = 20;
  private readonly maxPostCount = 100;
  private readonly minTokenLength = 20;
  private readonly recommendedTokenLength = 85;
  private readonly axiosInstance: AxiosInstance;
  private readonly accessToken: string;

  constructor(
    @InjectModel(Post.name) private postModel: Model<PostDocument>,
    private configService: ConfigService,
  ) {
    const token = this.configService.get<string>('VK_ACCESS_TOKEN') || '';
    // Убираем пробелы и проверяем, что токен не пустой
    this.accessToken = token.trim();

    if (!this.accessToken) {
      this.logger.warn(
        'VK_ACCESS_TOKEN не установлен. Парсинг ВК будет недоступен.',
      );
    } else if (this.accessToken.length < this.minTokenLength) {
      this.logger.warn(
        `VK_ACCESS_TOKEN выглядит неполным (длина: ${this.accessToken.length}). Токены ВК обычно содержат ${this.recommendedTokenLength}+ символов.`,
      );
    } else {
      this.logger.log(
        `VK_ACCESS_TOKEN загружен (длина: ${this.accessToken.length} символов)`,
      );
    }

    this.axiosInstance = axios.create({
      baseURL: this.vkApiUrl,
      timeout: 30000,
    });
  }

  /**
   * Нормализует ID группы ВК для использования в API
   * Поддерживает: числовой ID, короткое имя (club123, public123, auto_sales)
   * Возвращает owner_id в формате отрицательного числа для групп
   */
  private normalizeGroupIdForOwnerId(groupId: string): string {
    // Если это уже отрицательное число, возвращаем как есть
    if (groupId.startsWith('-') && /^-\d+$/.test(groupId)) {
      return groupId;
    }

    // Если это числовой ID без минуса, добавляем минус
    if (/^\d+$/.test(groupId)) {
      return `-${groupId}`;
    }

    // Если это префикс club или public, извлекаем ID и добавляем минус
    if (groupId.startsWith('club')) {
      const id = groupId.replace('club', '');
      return `-${id}`;
    }

    if (groupId.startsWith('public')) {
      const id = groupId.replace('public', '');
      return `-${id}`;
    }

    // Если это короткое имя (screen_name), возвращаем как есть для использования в domain
    return groupId;
  }

  /**
   * Получает посты из группы ВК через API
   * Возвращает объект с постами и owner_id группы
   */
  async fetchPostsFromGroup(
    groupId: string,
    count: number = 20,
    offset: number = 0,
  ): Promise<{ posts: VkPost[]; ownerId: number }> {
    if (!this.accessToken || this.accessToken.trim().length === 0) {
      throw new Error(
        'VK_ACCESS_TOKEN не установлен или пустой. Проверьте переменную окружения VK_ACCESS_TOKEN в файле .env и перезапустите приложение.',
      );
    }

    if (this.accessToken.length < this.minTokenLength) {
      this.logger.warn(
        `Внимание: VK_ACCESS_TOKEN выглядит неполным (длина: ${this.accessToken.length}). Токены ВК обычно содержат ${this.recommendedTokenLength}+ символов.`,
      );
    }

    const normalizedOwnerId = this.normalizeGroupIdForOwnerId(groupId);
    const params: Record<string, string | number> = {
      count: Math.min(count, this.maxPostCount),
      offset,
      access_token: this.accessToken,
      v: this.vkApiVersion,
      extended: 1, // Получаем информацию о группе для извлечения числового ID
    };

    let numericOwnerId: number;

    // Если ownerId начинается с минуса (числовой ID), используем owner_id
    // Иначе используем domain (короткое имя группы)
    if (normalizedOwnerId.startsWith('-')) {
      numericOwnerId = Math.abs(parseInt(normalizedOwnerId, 10));
      params.owner_id = normalizedOwnerId;
    } else {
      params.domain = normalizedOwnerId;
      // Если используем domain, нужно получить числовой ID из ответа
      numericOwnerId = 0; // Будет установлен из ответа
    }

    try {
      const response = await this.axiosInstance.get<
        VkWallResponse | VkErrorResponse
      >('/wall.get', { params });

      // Проверяем на ошибку API
      if ('error' in response.data) {
        const error = response.data.error;
        throw new Error(
          `VK API Error: ${error.error_msg} (code: ${error.error_code})`,
        );
      }

      const responseData = response.data.response;

      // Если использовали domain, получаем числовой ID из информации о группе
      if (
        numericOwnerId === 0 &&
        responseData.groups &&
        responseData.groups.length > 0
      ) {
        numericOwnerId = responseData.groups[0].id;
      }

      return {
        posts: responseData.items,
        ownerId: numericOwnerId,
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        this.logger.error(`Ошибка при запросе к VK API: ${error.message}`);
        throw new Error(`Ошибка при запросе к VK API: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Извлекает URL изображений из вложений поста ВК
   * Приоритет размеров: 'z' (максимальный) > 'y' > 'x' > последний доступный
   * @param attachments - Массив вложений поста
   * @returns Массив URL изображений в максимальном качестве
   */
  private extractImages(attachments: VkPost['attachments']): string[] {
    if (!attachments || attachments.length === 0) {
      return [];
    }

    const images: string[] = [];
    const sizePriority = ['z', 'y', 'x']; // Приоритет размеров изображений

    for (const attachment of attachments) {
      if (attachment.type === 'photo' && attachment.photo?.sizes) {
        const sizes = attachment.photo.sizes;

        // Ищем изображение по приоритету размеров
        let selectedSize = sizes.find((s) => s.type === sizePriority[0]);
        if (!selectedSize) {
          selectedSize = sizes.find((s) => s.type === sizePriority[1]);
        }
        if (!selectedSize) {
          selectedSize = sizes.find((s) => s.type === sizePriority[2]);
        }
        if (!selectedSize) {
          selectedSize = sizes[sizes.length - 1]; // Fallback на последний размер
        }

        if (selectedSize?.url) {
          images.push(selectedSize.url);
        }
      }
    }

    return images;
  }

  /**
   * Создает заголовок поста из текста
   * Берет первую строку текста, обрезает до 100 символов при необходимости
   * @param text - Текст поста
   * @returns Заголовок поста (максимум 100 символов)
   */
  private createTitle(text: string): string {
    const maxTitleLength = 100;
    const defaultTitle = 'Пост из ВК';

    if (!text || text.trim().length === 0) {
      return defaultTitle;
    }

    const firstLine = text.split('\n')[0].trim();

    if (firstLine.length <= maxTitleLength) {
      return firstLine;
    }

    return firstLine.substring(0, maxTitleLength - 3) + '...';
  }

  /**
   * Парсит посты из группы ВК и сохраняет их в базу данных
   * @param dto - DTO с параметрами парсинга (groupId, count, offset)
   * @returns Статистика парсинга: количество полученных, сохраненных, пропущенных постов и ошибок
   */
  async parseAndSavePosts(dto: ParseVkGroupDto): Promise<{
    parsed: number;
    saved: number;
    skipped: number;
    errors: number;
  }> {
    const { groupId, count = this.defaultPostCount, offset = 0 } = dto;

    this.logger.log(
      `Начало парсинга группы ВК: ${groupId}, count: ${count}, offset: ${offset}`,
    );

    try {
      const { posts: vkPosts, ownerId } = await this.fetchPostsFromGroup(
        groupId,
        count,
        offset,
      );

      if (vkPosts.length === 0) {
        this.logger.log('Посты не найдены');
        return { parsed: 0, saved: 0, skipped: 0, errors: 0 };
      }

      this.logger.log(
        `Получено постов из ВК: ${vkPosts.length}, owner_id: ${ownerId}`,
      );

      let saved = 0;
      let skipped = 0;
      let errors = 0;

      for (const vkPost of vkPosts) {
        try {
          const result = await this.processVkPost(vkPost, ownerId);
          if (result === 'saved') {
            saved++;
          } else if (result === 'skipped') {
            skipped++;
          }
        } catch (error) {
          errors++;
          this.logger.error(
            `Ошибка при обработке поста ${vkPost.id}: ${(error as Error).message}`,
          );
        }
      }

      this.logger.log(
        `Парсинг завершен: получено ${vkPosts.length}, сохранено ${saved}, пропущено ${skipped}, ошибок ${errors}`,
      );

      return {
        parsed: vkPosts.length,
        saved,
        skipped,
        errors,
      };
    } catch (error) {
      this.logger.error(
        `Ошибка при парсинге группы ВК: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /**
   * Обрабатывает один пост ВК: проверяет на дубликаты, валидирует и сохраняет
   * @param vkPost - Пост из API ВК
   * @param ownerId - Числовой ID группы
   * @returns 'saved' если пост сохранен, 'skipped' если пропущен
   */
  private async processVkPost(
    vkPost: VkPost,
    ownerId: number,
  ): Promise<'saved' | 'skipped'> {
    const postUrl = this.buildPostUrl(ownerId, vkPost.id);

    // Проверяем на дубликаты
    const existingPost = await this.postModel.findOne({ url: postUrl }).exec();
    if (existingPost) {
      return 'skipped';
    }

    // Пропускаем посты без текста
    const postText = vkPost.text?.trim() || '';
    if (!postText || postText.length === 0) {
      this.logger.debug(`Пропущен пост ${vkPost.id}: нет текста`);
      return 'skipped';
    }

    // Извлекаем и сохраняем данные поста
    const images = this.extractImages(vkPost.attachments);
    const title = this.createTitle(postText);

    const post = new this.postModel({
      title,
      text: postText,
      images,
      url: postUrl,
      createdAt: new Date(vkPost.date * 1000), // VK возвращает timestamp в секундах
    });

    await post.save();
    this.logger.debug(`Сохранен пост: ${postUrl}`);

    return 'saved';
  }

  /**
   * Формирует URL поста ВК в правильном формате
   * @param ownerId - Числовой ID группы (без минуса)
   * @param postId - ID поста
   * @returns URL поста в формате https://vk.com/wall-{owner_id}_{post_id}
   */
  private buildPostUrl(ownerId: number, postId: number): string {
    return `https://vk.com/wall-${ownerId}_${postId}`;
  }

  /**
   * Получает информацию о группе ВК
   * @param groupId - ID группы или короткое имя
   * @returns Информация о группе: id, name, screen_name
   */
  async getGroupInfo(groupId: string): Promise<{
    id: number;
    name: string;
    screen_name: string;
  }> {
    if (!this.accessToken) {
      throw new Error('VK_ACCESS_TOKEN не установлен');
    }

    const params: Record<string, string> = {
      access_token: this.accessToken,
      v: this.vkApiVersion,
    };

    // Если это числовой ID (с минусом или без), используем group_id
    const numericId = groupId.replace(/^club|^public|^-/g, '');
    if (/^\d+$/.test(numericId)) {
      params.group_id = numericId;
    } else {
      // Иначе используем domain (короткое имя)
      params.group_id = groupId;
    }

    try {
      const response = await this.axiosInstance.get('/groups.getById', {
        params,
      });

      if ('error' in response.data) {
        const error = response.data.error;
        throw new Error(
          `VK API Error: ${error.error_msg} (code: ${error.error_code})`,
        );
      }

      const group = response.data.response[0];
      return {
        id: group.id,
        name: group.name,
        screen_name: group.screen_name,
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        this.logger.error(
          `Ошибка при получении информации о группе: ${error.message}`,
        );
        throw new Error(
          `Ошибка при получении информации о группе: ${error.message}`,
        );
      }
      throw error;
    }
  }
}
