import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { Page } from 'puppeteer';
import { Car, CarDocument } from '../schemas/car.schema';
import { BaseParserService } from './utils/base-parser.service';
import { DEFAULT_HEADLESS } from './utils/browser-helper';
import { BrowserPool } from './utils/browser-pool.service';
import { ParallelParserHelper } from './utils/parallel-parser.helper';

interface ParseAllResult {
  total: number;
  parsed: number;
  skipped: number;
  errors: number;
  cars: Car[];
  errorsList: Array<{ url: string; error: string }>;
}

@Injectable()
export class HoogSelectionsParserService extends BaseParserService {
  constructor(@InjectModel(Car.name) private carModel: Model<CarDocument>) {
    super(HoogSelectionsParserService.name);
  }

  async parseAndSave(url: string): Promise<Car> {
    if (!url.includes('hoogselections.nl/product/')) {
      throw new Error(
        'URL должен быть с домена hoogselections.nl и страницы /product/',
      );
    }

    const useHeadless =
      process.env.NODE_ENV === 'production' ? DEFAULT_HEADLESS : false;

    const { browser, context, page } = await this.setupBrowserAndPage(
      useHeadless,
      [],
      true,
      {
        'accept-language': 'nl-NL,nl;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    );

    try {
      this.logger.log(`[HoogSelectionsParser] Opening page: ${url}`);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 0 });
      await page.waitForSelector('h1', { timeout: 30000 });

      const carDataToSave = await this.parseCarFromPage(page, url);

      return await this.carModel.findOneAndUpdate({ url }, carDataToSave, {
        upsert: true,
        new: true,
      });
    } finally {
      await this.closeBrowserAndContext(browser, context);
    }
  }

  async parseAndSaveWithPool(
    url: string,
    browserPool: BrowserPool,
  ): Promise<Car> {
    if (!url.includes('hoogselections.nl/product/')) {
      throw new Error(
        'URL должен быть с домена hoogselections.nl и страницы /product/',
      );
    }

    let page: Page | undefined;

    try {
      page = await browserPool.getPage(true, {
        'accept-language': 'nl-NL,nl;q=0.9,en-US;q=0.8,en;q=0.7',
      });

      this.logger.log(`[HoogSelectionsParser] Opening page: ${url}`);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 0 });

      await page.waitForSelector('h1', { timeout: 30000 });

      const carDataToSave = await this.parseCarFromPage(page, url);

      const car = await this.carModel.findOneAndUpdate({ url }, carDataToSave, {
        upsert: true,
        new: true,
      });

      return car;
    } catch (e) {
      this.logger.error(
        `[HoogSelectionsParser] Parse error: ${(e as Error).message}`,
        (e as Error).stack,
      );
      throw e;
    } finally {
      if (page) {
        await browserPool.releasePage(page);
      }
    }
  }

  private async parseCarFromPage(
    page: Page,
    url: string,
  ): Promise<Partial<Car>> {
    type Extracted = {
      title: string;
      url: string;
      rawBrand: string;
      rawModel: string;
      rawKm: string;
      rawDate: string;
      rawYear: string;
      rawTransmission: string;
      joinedPrices: string;
      images: string[];
      description: string;
      isSold: boolean;
      jsonLdBrand: string;
      jsonLdName: string;
      jsonLdPrice: number | null;
      jsonLdCurrency: string;
    };

    const extracted = (await page.evaluate((pageUrl: string) => {
      const getText = (el: Element | null | undefined) =>
        (el?.textContent || '').replace(/\s+/g, ' ').trim();

      const parseEuroNumber = (raw: string): number | null => {
        if (!raw) return null;
        const s = raw
          .trim()
          .replace(/\u00a0/g, ' ') // nbsp
          .replace(/[^\d.,\s]/g, '')
          .replace(/\s+/g, '');
        if (!s) return null;

        const hasDot = s.includes('.');
        const hasComma = s.includes(',');

        // Common EU format: 84.950,00 -> 84950.00
        if (hasDot && hasComma) {
          const normalized = s.replace(/\./g, '').replace(',', '.');
          const n = parseFloat(normalized);
          return Number.isFinite(n) ? n : null;
        }

        // If only comma exists, it's usually decimal separator.
        if (!hasDot && hasComma) {
          const normalized = s.replace(',', '.');
          const n = parseFloat(normalized);
          return Number.isFinite(n) ? n : null;
        }

        // If only dot exists, decide whether dot is thousands separator.
        // Treat as thousands when dot is followed by exactly 3 digits at the end or before another separator.
        if (hasDot && !hasComma) {
          if (/\.\d{3}(\.|$)/.test(s) || /\.\d{3}$/.test(s)) {
            const normalized = s.replace(/\./g, '');
            const n = parseFloat(normalized);
            return Number.isFinite(n) ? n : null;
          }
          const n = parseFloat(s);
          return Number.isFinite(n) ? n : null;
        }

        const n = parseFloat(s);
        return Number.isFinite(n) ? n : null;
      };

      const title =
        getText(document.querySelector('h1')) ||
        (document.title || '').trim() ||
        '';

      // "VERKOCHT" на их страницах встречается как часть шаблона,
      // поэтому определяем статус по WooCommerce/Schema.org availability.
      const bodyClass = (document.body?.className || '').toLowerCase();
      const hasOutOfStockClass =
        bodyClass.includes('outofstock') ||
        !!document.querySelector('.stock.out-of-stock') ||
        !!document.querySelector('.stock.outofstock');

      const ldJsonScripts = Array.from(
        document.querySelectorAll<HTMLScriptElement>(
          'script[type="application/ld+json"]',
        ),
      )
        .map((s) => s.textContent || '')
        .filter(Boolean);

      const safeJsonParse = (raw: string): unknown => {
        try {
          return JSON.parse(raw) as unknown;
        } catch {
          return null;
        }
      };

      const getAvailabilityFromJson = (
        value: unknown,
      ): 'InStock' | 'OutOfStock' | null => {
        if (!value) return null;
        if (typeof value === 'string') {
          const lower = value.toLowerCase();
          if (lower.includes('outofstock')) return 'OutOfStock';
          if (lower.includes('instock')) return 'InStock';
          return null;
        }
        if (Array.isArray(value)) {
          for (const v of value) {
            const a = getAvailabilityFromJson(v);
            if (a) return a;
          }
          return null;
        }
        if (typeof value === 'object') {
          const obj = value as Record<string, unknown>;
          return (
            getAvailabilityFromJson(obj.availability) ||
            getAvailabilityFromJson(obj.offers) ||
            getAvailabilityFromJson(obj.offer)
          );
        }
        return null;
      };

      let availability: 'InStock' | 'OutOfStock' | null = null;
      let jsonLdBrand = '';
      let jsonLdName = '';
      let jsonLdPrice: number | null = null;
      let jsonLdCurrency = '';
      for (const raw of ldJsonScripts) {
        const parsed = safeJsonParse(raw);
        if (!parsed) continue;

        const a = getAvailabilityFromJson(parsed);
        if (a && !availability) availability = a;

        // try to pick Product.name / Product.brand.name if present
        const pickProduct = (v: unknown): Record<string, unknown> | null => {
          if (!v) return null;
          if (Array.isArray(v)) {
            for (const item of v) {
              const p = pickProduct(item);
              if (p) return p;
            }
            return null;
          }
          if (typeof v !== 'object') return null;
          const obj = v as Record<string, unknown>;
          const t = obj['@type'];
          const types = Array.isArray(t) ? t : t ? [t] : [];
          if (types.some((x) => String(x).toLowerCase() === 'product')) {
            return obj;
          }
          // some pages use @graph
          if (obj['@graph']) return pickProduct(obj['@graph']);
          return null;
        };

        const product = pickProduct(parsed);
        if (product) {
          if (!jsonLdName && typeof product.name === 'string') {
            jsonLdName = product.name.trim();
          }
          if (!jsonLdBrand) {
            const b = product.brand;
            if (typeof b === 'string') jsonLdBrand = b.trim();
            else if (b && typeof b === 'object') {
              const bn = (b as Record<string, unknown>).name;
              if (typeof bn === 'string') jsonLdBrand = bn.trim();
            }
          }

          // price: prefer Product.offers.price / priceCurrency from JSON-LD when available
          if (jsonLdPrice == null) {
            const offers = product.offers ?? product.offer;
            const pickOffer = (v: unknown): Record<string, unknown> | null => {
              if (!v) return null;
              if (Array.isArray(v)) {
                for (const item of v) {
                  const o = pickOffer(item);
                  if (o) return o;
                }
                return null;
              }
              if (typeof v !== 'object') return null;
              return v as Record<string, unknown>;
            };
            const offer = pickOffer(offers);
            if (offer) {
              const cur = offer.priceCurrency;
              if (!jsonLdCurrency && typeof cur === 'string') {
                jsonLdCurrency = cur.trim();
              }

              const rawPrice = offer.price;
              const toNumber = (x: unknown): number | null => {
                if (typeof x === 'number' && Number.isFinite(x)) return x;
                if (typeof x === 'string') {
                  const cleaned = x
                    .trim()
                    .replace(/[^\d.,]/g, '')
                    .replace(/\.(?=\d{3}\b)/g, '') // remove thousand separators like "12.345"
                    .replace(',', '.');
                  const n = parseFloat(cleaned);
                  return Number.isFinite(n) ? n : null;
                }
                return null;
              };
              const p = toNumber(rawPrice);
              if (p != null && p > 0) jsonLdPrice = p;
            }
          }
        }
      }

      const isSold =
        availability === 'OutOfStock'
          ? true
          : hasOutOfStockClass
            ? true
            : false;

      // price (DOM fallback). Keep selectors narrow to avoid picking unrelated "price" blocks.
      const priceNodes = Array.from(
        document.querySelectorAll(
          '.summary .price, .product .price, .woocommerce-Price-amount, meta[itemprop="price"], [itemprop="price"]',
        ),
      );
      const priceTexts = priceNodes
        .map((n) => {
          if (n instanceof HTMLMetaElement) return (n.content || '').trim();
          const attr =
            (n as HTMLElement).getAttribute?.('content') ||
            (n as HTMLElement).getAttribute?.('value') ||
            '';
          return (attr || getText(n)).trim();
        })
        .filter(Boolean);
      const joinedPrices = priceTexts.join(' | ');
      const domPriceCandidates = priceTexts
        .map(parseEuroNumber)
        .filter((x): x is number => typeof x === 'number' && x > 0);
      const domPrice = domPriceCandidates.length
        ? Math.max(...domPriceCandidates)
        : null;

      // key/value specs (labels on page)
      // Page uses repeating blocks like: <div>Merk</div><div>Mercedes-Benz</div> (or similar)
      const specs: Record<string, string> = {};
      const allText = Array.from(document.querySelectorAll('body *'))
        .map((n) => getText(n))
        .filter((t) => t.length > 0 && t.length < 120);

      const normalizeKey = (k: string) =>
        k.toLowerCase().replace(/\s+/g, ' ').trim();

      const knownKeys = [
        'merk',
        'model',
        'km stand',
        'datum eerste toelating',
        'transmissie',
        'brandstof',
        // variants that occasionally appear on NL car pages / wp templates
        'bouwjaar',
        'jaar',
        'year',
        'first registration',
      ];

      for (let i = 0; i < allText.length - 1; i++) {
        const key = normalizeKey(allText[i]);
        if (!knownKeys.includes(key)) continue;
        const value = allText[i + 1];
        if (!value) continue;
        specs[key] = value;
      }

      // images: prefer wp-content uploads
      const imgCandidates = Array.from(
        document.querySelectorAll('img'),
      ).flatMap((img) => {
        const urls: string[] = [];
        const src = (img.getAttribute('src') || '').trim();
        const dataSrc = (img.getAttribute('data-src') || '').trim();
        const srcset = (img.getAttribute('srcset') || '').trim();
        if (src) urls.push(src);
        if (dataSrc) urls.push(dataSrc);
        if (srcset) {
          srcset
            .split(',')
            .map((p) => p.trim().split(' ')[0])
            .filter(Boolean)
            .forEach((u) => urls.push(u));
        }
        return urls;
      });

      const images = Array.from(
        new Set(
          imgCandidates
            .map((u) => u.trim())
            .filter((u) => u && !u.startsWith('data:image/'))
            .map((u) => (u.startsWith('//') ? 'https:' + u : u))
            .map((u) =>
              u.startsWith('/') ? 'https://hoogselections.nl' + u : u,
            )
            .filter((u) => u.startsWith('http'))
            .filter(
              (u) =>
                u.includes('/wp-content/uploads/') &&
                !u.toLowerCase().includes('logo') &&
                !u.toLowerCase().includes('icon'),
            ),
        ),
      );

      const normalizeText = (text: string) =>
        text
          .replace(/\r/g, '')
          .replace(/\n{3,}/g, '\n\n')
          .replace(/[ \t]+\n/g, '\n')
          .trim();

      const safeInnerText = (el: Element | null) => {
        if (!el) return '';
        const t = (el as HTMLElement).innerText || el.textContent || '';
        return normalizeText(t);
      };

      // description:
      // 1) try to extract the main story part: from "Bent u van plan" until "Opties"
      // 2) otherwise pick the longest reasonable content block among several candidates
      const storyFromHeaders = (() => {
        const headings = Array.from(
          document.querySelectorAll<HTMLElement>('h1,h2,h3'),
        );
        const start = headings.find((h) =>
          safeInnerText(h).toLowerCase().includes('bent u van plan'),
        );
        if (!start) return '';

        const stop = headings.find(
          (h) => h !== start && safeInnerText(h).toLowerCase() === 'opties',
        );

        const parts: string[] = [];
        let node: Element | null = start.nextElementSibling;
        while (node) {
          if (stop && node === stop) break;
          const t = safeInnerText(node);
          if (t) parts.push(t);
          node = node.nextElementSibling;
        }

        return normalizeText(parts.join('\n\n'));
      })();

      const candidateEls = [
        document.querySelector('.entry-content'),
        document.querySelector('article'),
        document.querySelector('main'),
        document.querySelector('.product'),
        document.querySelector('.woocommerce'),
        document.body,
      ];

      const bestCandidate = (() => {
        let best = '';
        for (const el of candidateEls) {
          const t = safeInnerText(el);
          // skip very short / useless blocks
          if (t.length < 200) continue;
          if (t.length > best.length) best = t;
        }
        return best;
      })();

      // Prefer the extracted story if it looks real; else use bestCandidate.
      const description = (
        storyFromHeaders && storyFromHeaders.length >= 200
          ? storyFromHeaders
          : bestCandidate
      ).trim();

      const rawKm = specs['km stand'] || '';
      const rawDate = specs['datum eerste toelating'] || '';
      const rawBrand = specs['merk'] || '';
      const rawModel = specs['model'] || '';
      const rawYear = specs['bouwjaar'] || specs['jaar'] || specs['year'] || '';
      const rawTransmission = specs['transmissie'] || '';

      return {
        title,
        url: pageUrl,
        rawBrand,
        rawModel,
        rawKm,
        rawDate,
        rawYear,
        rawTransmission,
        joinedPrices,
        domPrice,
        images,
        description,
        isSold,
        jsonLdBrand,
        jsonLdName,
        jsonLdPrice,
        jsonLdCurrency,
      };
    }, url)) as Extracted;

    const normalizeSpaces = (s: string) =>
      (s || '').replace(/\s+/g, ' ').trim();

    const titleNorm = normalizeSpaces(extracted.title || '');
    const jsonLdNameNorm = normalizeSpaces(extracted.jsonLdName || '');

    const brand = (() => {
      const candidate =
        normalizeSpaces(extracted.rawBrand || '') ||
        normalizeSpaces(extracted.jsonLdBrand || '');
      if (candidate) return candidate;

      // fallback: infer first token-ish from title (best-effort)
      const t = titleNorm || jsonLdNameNorm;
      if (!t) return '';
      // take up to first 2 words before a digit year/trim
      const m =
        t.match(
          /^([A-Za-zÀ-ÖØ-öø-ÿ0-9]+(?:[ -][A-Za-zÀ-ÖØ-öø-ÿ0-9]+)?)(?=\s)/,
        ) || t.match(/^([A-Za-zÀ-ÖØ-öø-ÿ0-9]+)$/);
      return m ? m[1].trim() : '';
    })();

    const model = (() => {
      const candidate = normalizeSpaces(extracted.rawModel || '');
      if (candidate) return candidate;

      const t = titleNorm || jsonLdNameNorm;
      if (!t) return '';

      // remove brand + year to get something resembling model
      const yearInTitle = (t.match(/\b(19|20)\d{2}\b/) || [])[0] || '';
      let rest = t;
      if (brand) {
        const re = new RegExp(
          `^\\s*${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`,
          'i',
        );
        rest = rest.replace(re, '');
      }
      if (yearInTitle) {
        rest = rest.replace(new RegExp(`\\b${yearInTitle}\\b`), '');
      }
      rest = normalizeSpaces(rest);
      return rest;
    })();

    const mileage = extracted.rawKm
      ? parseInt(extracted.rawKm.replace(/[^\d]/g, ''), 10) || 0
      : 0;

    const yearFromDate = (() => {
      const m = (extracted.rawDate || '').match(/\b(19|20)\d{2}\b/);
      return m ? parseInt(m[0], 10) : 0;
    })();

    const yearFromSpecs = (() => {
      const m = (extracted.rawYear || '').match(/\b(19|20)\d{2}\b/);
      return m ? parseInt(m[0], 10) : 0;
    })();

    const yearFromTitle = (() => {
      const m = (titleNorm || jsonLdNameNorm).match(/\b(19|20)\d{2}\b/);
      return m ? parseInt(m[0], 10) : 0;
    })();

    const yearFromDescription = (() => {
      const m = (extracted.description || '').match(/\b(19|20)\d{2}\b/);
      return m ? parseInt(m[0], 10) : 0;
    })();

    const year =
      yearFromDate ||
      yearFromSpecs ||
      yearFromTitle ||
      yearFromDescription ||
      0;

    const transmission = (() => {
      const t = (extracted.rawTransmission || '').toLowerCase();
      if (t.includes('automaat') || t.includes('automatic')) return 'AT';
      if (t.includes('hand') || t.includes('manual')) return 'MT';
      return '';
    })();

    const priceEur = (() => {
      // Prefer JSON-LD price if available and currency looks like EUR.
      if (
        typeof extracted.jsonLdPrice === 'number' &&
        Number.isFinite(extracted.jsonLdPrice) &&
        extracted.jsonLdPrice > 0
      ) {
        const cur = normalizeSpaces(
          extracted.jsonLdCurrency || '',
        ).toUpperCase();
        // if currency absent, still accept (many pages omit it); if present, require EUR.
        if (!cur || cur === 'EUR') {
          return Math.round(extracted.jsonLdPrice);
        }
      }

      if (
        typeof (extracted as unknown as { domPrice?: number | null })
          .domPrice === 'number' &&
        Number.isFinite(
          (extracted as unknown as { domPrice: number }).domPrice,
        ) &&
        (extracted as unknown as { domPrice: number }).domPrice > 0
      ) {
        return Math.round(
          (extracted as unknown as { domPrice: number }).domPrice,
        );
      }

      const s = extracted.joinedPrices || '';
      const prices: number[] = [];
      const re = /€\s*([0-9][0-9.\s]*)(?:,(\d{2}))?/g;
      for (const m of s.matchAll(re)) {
        const intPartRaw = (m[1] || '').trim();
        const intPart = intPartRaw.replace(/[^\d]/g, '');
        if (!intPart) continue;
        const eur = parseInt(intPart, 10);
        if (Number.isFinite(eur) && eur > 0) prices.push(eur);
      }

      if (prices.length === 0) return 0;
      return Math.max(...prices);
    })();

    const status: 'active' | 'sold' = extracted.isSold ? 'sold' : 'active';

    const carDataToSave: Partial<Car> = {
      title:
        extracted.title ||
        [brand, model, year].filter(Boolean).join(' ').trim(),
      url,
      brand,
      model,
      year,
      mileage,
      transmission,
      engineVolume: 0,
      description: extracted.description || '',
      images: extracted.images || [],
      location: {
        city: 'Katwijk',
        country: 'Netherlands',
      },
      price: priceEur ? { EUR: priceEur } : {},
      listingType: 'listing',
      status,
      lastChecked: new Date(),
    };

    return carDataToSave;
  }

  async getProductLinksFromShowroom(
    listUrl: string = 'https://hoogselections.nl/in-showroom/',
  ): Promise<string[]> {
    const { browser, context, page } = await this.setupBrowserAndPage(
      DEFAULT_HEADLESS,
      [],
      true,
      {
        'accept-language': 'nl-NL,nl;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    );

    try {
      const allLinks = new Set<string>();
      let currentUrl = listUrl;
      let pageCount = 0;

      while (currentUrl && pageCount < 20) {
        pageCount++;
        this.logger.log(
          `[HoogSelectionsParser] Opening showroom list page: ${currentUrl}`,
        );
        await page.goto(currentUrl, { waitUntil: 'networkidle2', timeout: 0 });

        await page.waitForSelector('a[href*="/product/"]', { timeout: 30000 });

        const { links, nextUrl } = await page.evaluate(() => {
          const hrefToAbs = (href: string) => {
            if (!href) return '';
            if (href.startsWith('http')) return href;
            if (href.startsWith('//')) return 'https:' + href;
            if (href.startsWith('/')) return 'https://hoogselections.nl' + href;
            return href;
          };

          const links = Array.from(
            document.querySelectorAll<HTMLAnchorElement>(
              'a[href*="/product/"]',
            ),
          )
            .map((a) => hrefToAbs(a.getAttribute('href') || ''))
            .filter((u) => u.includes('hoogselections.nl/product/'))
            .filter((u) => !u.includes('/product-category/'));

          const next =
            document.querySelector<HTMLAnchorElement>('a.next.page-numbers') ||
            document.querySelector<HTMLAnchorElement>('link[rel="next"]');

          const nextHref =
            next?.getAttribute('href') ||
            (next instanceof HTMLLinkElement ? next.href : '');

          return {
            links: Array.from(new Set(links)),
            nextUrl: hrefToAbs(nextHref || ''),
          };
        });

        links.forEach((l) => allLinks.add(l));
        if (!nextUrl || nextUrl === currentUrl) break;
        currentUrl = nextUrl;
      }

      return Array.from(allLinks);
    } finally {
      await this.closeBrowserAndContext(browser, context);
    }
  }

  async parseAllCarsFromList(
    listUrl: string = 'https://hoogselections.nl/in-showroom/',
  ): Promise<ParseAllResult> {
    const result: ParseAllResult = {
      total: 0,
      parsed: 0,
      skipped: 0,
      errors: 0,
      cars: [],
      errorsList: [],
    };

    this.logger.log(
      `[HoogSelectionsParser] Starting global parsing from: ${listUrl}`,
    );

    const links = await this.getProductLinksFromShowroom(listUrl);
    result.total = links.length;
    this.logger.log(
      `[HoogSelectionsParser] Found ${links.length} total listings`,
    );

    const browserPool = new BrowserPool('HoogSelectionsParser');
    const useHeadless =
      process.env.NODE_ENV === 'production' ? DEFAULT_HEADLESS : false;
    await browserPool.initialize(useHeadless, []);

    try {
      const parseResults =
        await ParallelParserHelper.processInParallelWithDelay(
          links,
          async (link, index) => {
            this.logger.log(
              `[HoogSelectionsParser] Parsing ${index + 1}/${links.length}: ${link}`,
            );
            return await this.parseAndSaveWithPool(link, browserPool);
          },
          5,
          500,
          this.logger,
        );

      for (const r of parseResults) {
        if (r.error) {
          result.errors++;
          result.errorsList.push({ url: r.item, error: r.error });
        } else if (!r.result) {
          result.skipped++;
        } else {
          result.parsed++;
          result.cars.push(r.result);
        }
      }
    } finally {
      await browserPool.cleanup();
    }

    this.logger.log(
      `[HoogSelectionsParser] Global parsing completed: ${result.parsed} parsed, ${result.skipped} skipped, ${result.errors} errors`,
    );

    return result;
  }
}
