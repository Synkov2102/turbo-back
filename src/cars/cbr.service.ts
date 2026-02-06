import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as xml2js from 'xml2js';

interface ExchangeRates {
  USD: number;
  EUR: number;
}

interface Valute {
  CharCode: string[];
  Value: string[];
  Nominal: string[];
}

interface ValCurs {
  ValCurs: {
    Valute: Valute[];
  };
}

@Injectable()
export class CbrService {
  private readonly logger = new Logger(CbrService.name);
  private readonly CBR_URL = 'http://www.cbr.ru/scripts/XML_daily.asp';

  /**
   * Получает курсы валют с сайта ЦБ РФ
   * @param date Дата в формате dd/mm/yyyy (опционально, по умолчанию текущая дата)
   * @returns Объект с курсами USD и EUR
   */
  async getExchangeRates(date?: string): Promise<ExchangeRates> {
    try {
      const url = date ? `${this.CBR_URL}?date_req=${date}` : this.CBR_URL;

      this.logger.log(`Запрос курсов валют с ЦБ РФ: ${url}`);

      const response = await axios.get(url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0',
        },
      });

      return await this.parseXmlResponse(String(response.data));
    } catch (error) {
      this.logger.error(
        `Ошибка при получении курсов валют: ${(error as Error).message}`,
      );
      throw new Error(
        `Не удалось получить курсы валют: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Парсит XML ответ от ЦБ РФ и извлекает курсы валют
   */
  private async parseXmlResponse(xmlData: string): Promise<ExchangeRates> {
    return new Promise((resolve, reject) => {
      xml2js.parseString(xmlData, (err, result: ValCurs) => {
        if (err) {
          reject(new Error(`Ошибка парсинга XML: ${err.message}`));
          return;
        }

        const valutes = result.ValCurs.Valute || [];
        const rates: ExchangeRates = {
          USD: 0,
          EUR: 0,
        };

        for (const valute of valutes) {
          const charCode = valute.CharCode?.[0];
          const valueStr = valute.Value?.[0];
          const nominalStr = valute.Nominal?.[0];

          if (!charCode || !valueStr || !nominalStr) continue;

          // Значение в XML приходит в формате "92,1234" (запятая как разделитель)
          const value = parseFloat(valueStr.replace(',', '.'));
          const nominal = parseFloat(nominalStr);

          if (charCode === 'USD') {
            rates.USD = value / nominal; // Курс за 1 единицу валюты
          } else if (charCode === 'EUR') {
            rates.EUR = value / nominal;
          }
        }

        if (rates.USD === 0 || rates.EUR === 0) {
          reject(
            new Error(
              'Не удалось получить курсы валют: USD или EUR не найдены в ответе',
            ),
          );
          return;
        }

        this.logger.log(
          `Курсы валют получены: USD = ${rates.USD}, EUR = ${rates.EUR}`,
        );
        resolve(rates);
      });
    });
  }
}
