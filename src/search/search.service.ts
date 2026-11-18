import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, MoreThanOrEqual, Repository } from 'typeorm';
import { AiService } from 'src/ai/ai.service';
import { JobEntity } from 'src/Entities/job.entity';
import { JobClickEntity } from 'src/Entities/job-click.entity';
import { SearchQueryEntity } from 'src/Entities/search-query.entity';
import { FilterJobDto } from 'src/job/dto/filter-job.dto';
import { JOB_CATEGORY_KEYS } from 'src/job/job-category';
import { CITY_MAPPING, JobService } from 'src/job/job.service';
import { buildIntentPrompt, isShareableQuery, looksLikeSentence, normalizeQuery, QueryIntent, sanitizeIntent } from './query-intent';

const CITIES = Object.keys(CITY_MAPPING);
const INTENT_CACHE_SIZE = 1000;
/** "Frequently searched": searched at least this often in the last POPULAR_DAYS, and found something */
const POPULAR_MIN_COUNT = 3;
const POPULAR_DAYS = 14;
const POPULAR_CACHE_MS = 10 * 60 * 1000;

/**
 * The AI job search: a sentence ("მინდა ბუღალტრად ვიმუშაო ბათუმში") is turned into filters by
 * Gemini, short searches go straight to the keyword search. Either way the results come from
 * JobService.findAll, with its limits.
 */
@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);
  /** Same sentence, same filters: one Gemini call per distinct sentence (until the cache rolls over) */
  private readonly intentCache = new Map<string, QueryIntent | null>();
  private popularCache: { at: number; queries: string[] } | null = null;

  constructor(
    private readonly jobService: JobService,
    private readonly aiService: AiService,
    @InjectRepository(JobEntity) private readonly jobRepo: Repository<JobEntity>,
    @InjectRepository(JobClickEntity) private readonly clickRepo: Repository<JobClickEntity>,
    @InjectRepository(SearchQueryEntity) private readonly queryRepo: Repository<SearchQueryEntity>,
  ) {}

  async search(filter: FilterJobDto) {
    const text = filter.query?.trim() ?? '';
    const intent = text && looksLikeSentence(text) ? await this.interpret(text) : null;

    // The visitor's own filters win over what the AI read into the sentence
    const interpreted: FilterJobDto = intent
      ? {
          ...filter,
          query: intent.keywords,
          location: filter.location || intent.city || undefined,
          category: filter.category || intent.category || undefined,
        }
      : filter;

    let result = await this.jobService.findAll(interpreted);
    // "ბუღალტერი ბათუმში" found nothing by title: the category and city alone still might
    if (intent?.keywords && !result.jobs.length && (interpreted.location || interpreted.category)) {
      result = await this.jobService.findAll({ ...interpreted, query: undefined });
    }

    if (text && (filter.page ?? 1) === 1) {
      void this.recordQuery(text, result.counts.filteredRecords).catch(() => undefined);
    }
    return { ...result, interpreted: intent };
  }

  /** Where a result's "open the original" sends the visitor; null = no such vacancy or no usable link. */
  async clickOut(jobId: number): Promise<string | null> {
    const job = await this.jobRepo.findOne({ where: { id: jobId }, select: ['id', 'link'] });
    let url: URL;
    try {
      url = new URL(job?.link ?? '');
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    void this.clickRepo
      .insert({ jobId, host: url.hostname.replace(/^www\./, '').slice(0, 100) })
      .catch(() => undefined);
    return url.toString();
  }

  /** The most searched texts in the last `days`, with how many results they found. */
  async topQueries(days = 30, limit = 100) {
    return this.queryRepo.find({
      where: { lastSearchedAt: MoreThan(new Date(Date.now() - days * 24 * 3600 * 1000)) },
      order: { count: 'DESC' },
      take: Math.min(limit, 500),
    });
  }

  /**
   * The public "frequently searched" list for the home page: recent searches many visitors made that
   * found vacancies, minus anything that could be personal (see isShareableQuery). Cached for 10 minutes.
   */
  async popularQueries(limit = 10): Promise<string[]> {
    if (!this.popularCache || Date.now() - this.popularCache.at > POPULAR_CACHE_MS) {
      const rows = await this.queryRepo.find({
        select: ['query'],
        where: {
          lastSearchedAt: MoreThan(new Date(Date.now() - POPULAR_DAYS * 24 * 3600 * 1000)),
          count: MoreThanOrEqual(POPULAR_MIN_COUNT),
          lastResults: MoreThan(0),
        },
        order: { count: 'DESC' },
        take: 100,
      });
      const queries = [...new Set(rows.map((row) => row.query.trim()).filter(isShareableQuery))].slice(0, 20);
      this.popularCache = { at: Date.now(), queries };
    }
    return this.popularCache.queries.slice(0, Math.min(Math.max(limit, 1), 20));
  }

  /** Click-outs per site in the last `days`. */
  async clicksBySite(days = 30): Promise<{ host: string; clicks: number }[]> {
    const rows = await this.clickRepo
      .createQueryBuilder('click')
      .select('click.host', 'host')
      .addSelect('COUNT(*)::int', 'clicks')
      .where('click.createdAt > :since', { since: new Date(Date.now() - days * 24 * 3600 * 1000) })
      .groupBy('click.host')
      .orderBy('clicks', 'DESC')
      .getRawMany();
    return rows;
  }

  private async interpret(text: string): Promise<QueryIntent | null> {
    const key = normalizeQuery(text);
    if (this.intentCache.has(key)) return this.intentCache.get(key) ?? null;

    const raw = await this.aiService.generateJson(buildIntentPrompt(text, CITIES, JOB_CATEGORY_KEYS), 'searchIntent');
    const intent = sanitizeIntent(raw, CITIES, JOB_CATEGORY_KEYS);
    // A failed call isn't cached: the next search tries again
    if (raw) {
      if (this.intentCache.size >= INTENT_CACHE_SIZE) this.intentCache.delete(this.intentCache.keys().next().value!);
      this.intentCache.set(key, intent);
    }
    return intent;
  }

  private async recordQuery(text: string, results: number) {
    const query = normalizeQuery(text);
    if (query.length < 2) return;
    await this.queryRepo.query(
      `INSERT INTO search_queries (query, count, "lastResults", "lastSearchedAt")
       VALUES ($1, 1, $2, now())
       ON CONFLICT (query) DO UPDATE
       SET count = search_queries.count + 1, "lastResults" = EXCLUDED."lastResults", "lastSearchedAt" = now()`,
      [query, results],
    );
  }
}
