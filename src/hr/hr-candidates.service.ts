import { createHash } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import { Cv } from 'src/Entities/cv.entity';
import { User } from 'src/Entities/user.entity';
import { CONTACT_ACCESS, HrCvAccess, HrCvAccessAction } from 'src/Entities/hr-cv-access.entity';
import { UserRole } from 'src/enums/user-role.enum';
import { HrVacancyStatus } from 'src/Entities/hr-vacancy.entity';
import { HrAiSearchLog } from 'src/Entities/hr-ai-search-log.entity';
import { AiService } from 'src/ai/ai.service';
import { R2StorageService } from 'src/cv/r2-storage.service';
import { PublicCvLimitsService } from 'src/cv/public-cv-limits.service';
import { LinkedinProfile, LinkedinSearchService } from 'src/linkedin-search/linkedin-search.service';
import { LinkedinSearchDto } from 'src/linkedin-search/dto/linkedin-search.dto';
import { HrAiCandidateSearchDto, HrCandidateSearchDto } from './dto/hr-candidate-search.dto';
import { CreateManualCandidateDto } from './dto/hr-vacancy.dto';
import { CandidateCriteria, CandidateFilters, fitsWithoutKeywords, scoreCvForCriteria } from './candidate-score';
import { universityEnglishNames } from 'src/cv/georgian-universities';
import {
  AiRanking,
  buildExpandPrompt,
  buildRankPrompt,
  cvRankId,
  ExpandedQuery,
  linkedinRankId,
  parseExpandedQuery,
  parseRankings,
  toCvRankItem,
  toLinkedinRankItem,
} from './candidate-ai-search';
import { BoardFilter, HrPipelineService, PipelineView, toView, VacancyMembership } from './hr-pipeline.service';
import { HrVacancyService } from './hr-vacancy.service';

const DAY_SEC = 24 * 60 * 60;
const envInt = (name: string, fallback: number) => Number(process.env[name]) || fallback;
export const HR_CV_UNLOCKS_PER_MONTH = envInt('HR_CV_UNLOCKS_PER_MONTH', 50);
export const HR_LINKEDIN_SEARCHES_PER_DAY = envInt('HR_LINKEDIN_SEARCHES_PER_DAY', 30);
const HR_CV_SEARCHES_PER_HOUR = envInt('HR_CV_SEARCHES_PER_HOUR', 120);
// Each new AI search costs two AI calls; paging through a cached one is free.
const HR_AI_SEARCHES_PER_HOUR = envInt('HR_AI_SEARCHES_PER_HOUR', 30);
const AI_SEARCH_CACHE_SEC = 60 * 60;
// A search whose LinkedIn half was skipped or failed is kept briefly, so a retry can include LinkedIn
const AI_SEARCH_PARTIAL_CACHE_SEC = 5 * 60;
// How many of the best keyword matches the AI reads and ranks
const AI_RANK_POOL = 80;
// The browser fallback can be slow; past this the AI search goes on with our CVs only
const AI_LINKEDIN_TIMEOUT_MS = 30_000;
// The SQL prefilter (keyword anywhere in the summary) bounds how many CVs get scored in memory.
const PREFILTER_LIMIT = 2000;
const MAX_RANKED = 200;

export interface CandidateContact {
  fullName: string | null;
  email: string | null;
  phoneNumber: string | null;
}

/** Anonymized CV card: summary only. Contacts are filled in once this HR has unlocked the CV. */
export interface HrCandidate {
  id: number;
  detectedRole: string;
  seniorityLevel: string;
  careerDirection: string;
  primarySkills: string[];
  secondarySkills: string[];
  domains: string[];
  locationPreference: string;
  updatedAt: Date;
  match?: number;
  matchedKeywords?: string[];
  unlocked: boolean;
  contact: CandidateContact | null;
  /** This HR's vacancies the CV is in (unlocked CVs only). */
  vacancies: VacancyMembership[];
  /** Added by hand by this HR: name and position only, no file or AI summary */
  manual: boolean;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&');
const splitKeywords = (keyword: string) =>
  Array.from(new Set(keyword.split(',').map((k) => k.trim()).filter(Boolean))).slice(0, 10);
/** "A, B" from a filter field -> ['A', 'B'] (at most 5) */
const splitList = (value?: string) => (value ? splitKeywords(value).slice(0, 5) : []);

/** The form's comma-separated filter fields as lists */
const filtersFromDto = (dto: { company?: string; university?: string; skills?: string; languages?: string }): Required<CandidateFilters> => ({
  companies: splitList(dto.company),
  universities: splitList(dto.university),
  skills: splitList(dto.skills),
  languages: splitList(dto.languages),
});

type SummaryListField = 'companies' | 'universities' | 'primarySkills' | 'secondarySkills' | 'languages';
const jsonList = (field: SummaryListField) =>
  `(CASE WHEN jsonb_typeof(cv.summary->'${field}') = 'array' THEN cv.summary->'${field}' ELSE '[]'::jsonb END)`;

/**
 * A filter on the summary's lists (case-insensitive "contains"): `groups` are AND-ed, the terms in
 * a group OR-ed. CVs not re-analyzed yet don't have the fact lists, so those filters skip them.
 */
const summaryListFilter = (fields: SummaryListField[], groups: string[][], paramPrefix: string) => {
  const kept = groups.map((g) => g.map((t) => t.trim()).filter(Boolean)).filter((g) => g.length);
  if (!kept.length) return '1=1';
  const source = fields.map(jsonList).join(' || ');
  const params: Record<string, string> = {};
  const clauses = kept.map((terms, gi) => {
    const ors = terms.map((term, ti) => {
      const name = `${paramPrefix}${gi}_${ti}`;
      params[name] = `%${escapeLike(term)}%`;
      return `entry ILIKE :${name}`;
    });
    return `EXISTS (SELECT 1 FROM jsonb_array_elements_text(${source}) AS entry WHERE ${ors.join(' OR ')})`;
  });
  return new Brackets((qb) => qb.where(clauses.join(' AND '), params));
};
// Used when the AI can't expand the request: its longer words as plain keywords
const queryWords = (query: string) =>
  Array.from(new Set(query.toLowerCase().split(/[\s,;.]+/).filter((w) => w.length >= 3))).slice(0, 10);
const startOfMonthUtc = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
};

/** How the LinkedIn half of an AI search went: `quota` = the HR's daily LinkedIn searches are used up. */
export type AiLinkedinStatus = 'ok' | 'quota' | 'failed';

type AiVerdict = Pick<AiRanking, 'reason' | 'missing' | 'unverified'>;
/** One AI search result: a CV card from our base, or a LinkedIn profile (match null only without the AI). */
export type HrAiResult =
  | (HrCandidate & AiVerdict & { source: 'cv' })
  | (AiVerdict & { source: 'linkedin'; profile: LinkedinProfile; match: number | null });

/** The form's hard filters, applied on top of what the AI reads from the request */
type AiSearchFilters = Required<CandidateFilters> & { openToWork: boolean };

interface CachedAiSearch {
  expanded: ExpandedQuery;
  poolSize: number;
  linkedinProfiles: LinkedinProfile[];
  linkedin: AiLinkedinStatus;
  rankings: AiRanking[];
  aiRanked: boolean;
}

const linkedinQuotaKey = (hrUserId: number) => `hr:linkedin:${hrUserId}:${new Date().toISOString().slice(0, 10)}`;

@Injectable()
export class HrCandidatesService {
  private readonly logger = new Logger(HrCandidatesService.name);

  constructor(
    @InjectRepository(Cv) private readonly cvRepository: Repository<Cv>,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(HrCvAccess) private readonly accessRepository: Repository<HrCvAccess>,
    @InjectRepository(HrAiSearchLog) private readonly aiSearchLogRepository: Repository<HrAiSearchLog>,
    private readonly r2StorageService: R2StorageService,
    private readonly limits: PublicCvLimitsService,
    private readonly linkedinSearchService: LinkedinSearchService,
    private readonly pipelineService: HrPipelineService,
    private readonly vacancyService: HrVacancyService,
    private readonly aiService: AiService,
  ) {}

  /** Ranked, anonymized CVs (every CV with an AI summary is searchable). */
  async searchCvs(hr: User, dto: HrCandidateSearchDto) {
    await this.limits.consume(
      `hr:cv-search:${hr.id}`,
      HR_CV_SEARCHES_PER_HOUR,
      3600,
      'ძიების ლიმიტი ამოიწურა, სცადეთ მოგვიანებით',
    );

    const keywords = splitKeywords(dto.keyword ?? '');
    const criteria = { location: dto.location?.trim(), seniority: dto.seniority, ...filtersFromDto(dto) };
    const hasFilter =
      !!criteria.location || !!criteria.seniority || [criteria.universities, criteria.skills, criteria.languages].some((l) => l.length);
    if (!keywords.length && !hasFilter) throw new BadRequestException('შეიყვანეთ საძიებო სიტყვა ან აირჩიეთ ფილტრი');

    // Without a keyword: the CVs that pass the filters, newest first, with no match score
    const ranked: { cv: Cv; score?: { match: number; matchedKeywords: string[] } }[] = (
      keywords.length ? await this.findCandidatePool({ keywords, ...criteria }) : await this.findByFilters(criteria)
    ).slice(0, MAX_RANKED);

    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const pageItems = ranked.slice((page - 1) * limit, page * limit);
    const cards = await this.toCards(hr.id, pageItems.map((r) => r.cv));

    return {
      total: ranked.length,
      page,
      limit,
      candidates: cards.map((card, i) => ({ ...card, ...pageItems[i].score })),
    };
  }

  /**
   * The candidate described in plain language, searched in our CV base and on LinkedIn at once:
   * the AI turns the request into keywords (and LinkedIn titles), the keyword search finds the best
   * AI_RANK_POOL CVs while one LinkedIn search runs, and the AI ranks both together with a reason
   * for each. A search is cached, so paging through it costs nothing. Without the AI, results still
   * come back: CVs by the deterministic score, then LinkedIn in Google's order, without reasons.
   */
  async searchCvsWithAi(hr: User, dto: HrAiCandidateSearchDto) {
    const query = dto.query.replace(/\s+/g, ' ').trim();
    if (!query) throw new BadRequestException('Describe the candidate you are looking for');

    const filters: AiSearchFilters = { ...filtersFromDto(dto), openToWork: dto.openToWork ?? false };
    // Other filters make another search, cached apart
    const cacheId = `${query}|${JSON.stringify(filters)}`.toLowerCase();
    const cacheKey = `hr:ai-search:${createHash('sha256').update(cacheId).digest('hex')}`;
    let search = await this.limits.getJson<CachedAiSearch>(cacheKey);
    const fresh = !search;
    if (!search) {
      await this.limits.consume(
        `hr:ai-search:${hr.id}`,
        HR_AI_SEARCHES_PER_HOUR,
        3600,
        'AI ძიების ლიმიტი ამოიწურა, სცადეთ მოგვიანებით',
      );
      search = await this.runAiSearch(hr, query, filters);
      const ttl = search.linkedin === 'ok' ? AI_SEARCH_CACHE_SEC : AI_SEARCH_PARTIAL_CACHE_SEC;
      await this.limits.setJson(cacheKey, search, ttl);
    }

    const page = dto.page ?? 1;
    const limit = dto.limit ?? 10;
    if (fresh || page === 1) {
      await this.aiSearchLogRepository
        .insert({
          hrUserId: hr.id,
          query: query.slice(0, 500),
          keywords: search.expanded.keywords,
          poolSize: search.poolSize,
          linkedinCount: search.linkedinProfiles.length,
          resultCvIds: search.rankings.filter((r) => r.id.startsWith('cv:')).map((r) => Number(r.id.slice(3))),
          aiRanked: search.aiRanked,
        })
        .catch(() => null);
    }

    // CVs deleted since the search was cached drop out
    const pageRankings = search.rankings.slice((page - 1) * limit, page * limit);
    const cvIds = pageRankings.filter((r) => r.id.startsWith('cv:')).map((r) => Number(r.id.slice(3)));
    const cvs = cvIds.length ? await this.cvRepository.find({ where: { id: In(cvIds) } }) : [];
    const cards = new Map((await this.toCards(hr.id, cvs)).map((c) => [cvRankId(c.id), c]));
    const profiles = new Map(search.linkedinProfiles.map((p, i) => [linkedinRankId(i), p]));

    return {
      total: search.rankings.length,
      page,
      limit,
      understood: search.expanded,
      aiRanked: search.aiRanked,
      linkedin: search.linkedin,
      candidates: pageRankings.flatMap(({ id, ...ranking }): HrAiResult[] => {
        const card = cards.get(id);
        if (card) return [{ source: 'cv', ...card, ...ranking, match: ranking.match ?? undefined }];
        const profile = profiles.get(id);
        return profile ? [{ source: 'linkedin', profile, ...ranking }] : [];
      }),
    };
  }

  private async runAiSearch(hr: User, query: string, filters: AiSearchFilters): Promise<CachedAiSearch> {
    const expanded = parseExpandedQuery(
      await this.aiService.generateJson(buildExpandPrompt(query), 'hrAiSearch.expand'),
    ) ?? { keywords: queryWords(query), titles: queryWords(query).slice(0, 3) };
    const empty = { expanded, poolSize: 0, linkedinProfiles: [], rankings: [] };
    if (!expanded.keywords.length) return { ...empty, linkedin: 'ok', aiRanked: false };

    const [fullPool, linkedin] = await Promise.all([
      this.findCandidatePool({ ...expanded, ...filters }),
      this.searchLinkedinForAi(hr, expanded, filters),
    ]);
    const pool = fullPool.slice(0, AI_RANK_POOL);
    const base = { expanded, poolSize: pool.length, linkedinProfiles: linkedin.profiles, linkedin: linkedin.status };
    if (!pool.length && !linkedin.profiles.length) return { ...base, rankings: [], aiRanked: true };

    const items = [
      ...pool.map((r) => toCvRankItem(r.cv.id, r.cv.summary!)),
      ...linkedin.profiles.map((p, i) => toLinkedinRankItem(i, p)),
    ];
    const rankings = parseRankings(
      await this.aiService.generateJson(buildRankPrompt(query, items), 'hrAiSearch.rank'),
      new Set(items.map((item) => item.id)),
    );
    if (rankings) return { ...base, rankings, aiRanked: true };

    return {
      ...base,
      rankings: [
        ...pool.slice(0, 20).map((r) => ({ id: cvRankId(r.cv.id), match: r.score.match, reason: '', missing: [], unverified: [] })),
        ...linkedin.profiles.map((_, i) => ({ id: linkedinRankId(i), match: null, reason: '', missing: [], unverified: [] })),
      ],
      aiRanked: false,
    };
  }

  /**
   * One LinkedIn page for an AI search, spending one of the HR's daily LinkedIn searches (admins
   * are not limited). Never throws: an empty quota, a failure or a timeout just leaves LinkedIn out.
   */
  private async searchLinkedinForAi(
    hr: User,
    expanded: ExpandedQuery,
    filters: AiSearchFilters,
  ): Promise<{ profiles: LinkedinProfile[]; status: AiLinkedinStatus }> {
    if (
      hr.role !== UserRole.ADMIN &&
      !(await this.limits.tryConsume(linkedinQuotaKey(hr.id), HR_LINKEDIN_SEARCHES_PER_DAY, DAY_SEC))
    ) {
      return { profiles: [], status: 'quota' };
    }

    // "Remote" as a quoted Google term would only find profiles that literally say it
    const location = expanded.location && !/remote|დისტანციურ/i.test(expanded.location) ? expanded.location : undefined;
    let timer: NodeJS.Timeout | undefined;
    try {
      const res = await Promise.race([
        this.linkedinSearchService.search({
          keyword: expanded.titles.join(','),
          location,
          company: filters.companies.join(','),
          university: filters.universities.join(','),
          skills: filters.skills.join(','),
          languages: filters.languages.join(','),
          openToWork: filters.openToWork,
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timed out')), AI_LINKEDIN_TIMEOUT_MS);
        }),
      ]);
      return { profiles: res.profiles, status: 'ok' };
    } catch (e) {
      this.logger.warn(`AI search: LinkedIn part skipped (${(e as Error).message})`);
      return { profiles: [], status: 'failed' };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Searchable CVs matching any keyword, best deterministic score first. Both searches start here;
   * this is the step to swap for a vector search once keywords stop finding the right people.
   */
  private async findCandidatePool(criteria: CandidateCriteria) {
    const cvs = await this.poolQuery(criteria)
      .andWhere(
        new Brackets((qb) =>
          criteria.keywords.forEach((k, i) =>
            qb.orWhere(`cv.summary::text ILIKE :k${i}`, { [`k${i}`]: `%${escapeLike(k)}%` }),
          ),
        ),
      )
      .getMany();

    return cvs
      .map((cv) => ({ cv, score: scoreCvForCriteria(cv.summary!, criteria) }))
      .filter((r): r is { cv: Cv; score: NonNullable<typeof r.score> } => r.score !== null)
      .sort((a, b) => b.score.match - a.score.match || b.cv.updatedAt.getTime() - a.cv.updatedAt.getTime());
  }

  /** Filters only, no keyword: the searchable CVs that pass them, newest first. */
  private async findByFilters(criteria: Omit<CandidateCriteria, 'keywords'>) {
    const cvs = await this.poolQuery(criteria).getMany();
    return cvs.filter((cv) => fitsWithoutKeywords(cv.summary!, criteria)).map((cv) => ({ cv }));
  }

  /** Searchable CVs passing the filters (employers, universities, skills, languages from the summary), newest first. */
  private poolQuery(criteria: CandidateFilters) {
    return this.cvRepository
      .createQueryBuilder('cv')
      .where('cv.summary IS NOT NULL')
      // HR-added records are private to their HR (they have no summary either; this is the rule itself)
      .andWhere('cv.addedByHrId IS NULL')
      // Any of the companies; any of the universities (by its English names)
      .andWhere(summaryListFilter(['companies'], [criteria.companies ?? []], 'co'))
      .andWhere(summaryListFilter(['universities'], [(criteria.universities ?? []).flatMap(universityEnglishNames)], 'uni'))
      // Every skill; every language
      .andWhere(summaryListFilter(['primarySkills', 'secondarySkills'], (criteria.skills ?? []).map((s) => [s]), 'sk'))
      .andWhere(summaryListFilter(['languages'], (criteria.languages ?? []).map((l) => [l]), 'lang'))
      .orderBy('cv.updatedAt', 'DESC')
      .take(PREFILTER_LIMIT);
  }

  /**
   * Opens a candidate's contacts (and file) for this HR. Re-opening an already unlocked CV is free;
   * a new one counts toward the monthly quota (admins are not limited).
   */
  async unlock(hr: User, cvId: number): Promise<HrCandidate> {
    const cv = await this.findCv(hr.id, cvId);

    if (!(await this.isUnlocked(hr.id, cvId))) {
      if (hr.role !== UserRole.ADMIN && (await this.unlocksThisMonth(hr.id)) >= HR_CV_UNLOCKS_PER_MONTH) {
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: `ამ თვეში კონტაქტების გახსნის ლიმიტი (${HR_CV_UNLOCKS_PER_MONTH}) ამოიწურა`,
            limit: HR_CV_UNLOCKS_PER_MONTH,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      await this.accessRepository.insert({ hrUserId: hr.id, cvId, action: HrCvAccessAction.UNLOCK });
    }
    await this.pipelineService.ensureEntry(hr.id, cvId);

    const [card] = await this.toCards(hr.id, [cv]);
    return card;
  }

  /** Unlocks the CV if needed (same quota as unlock) and puts it on the vacancy's board. */
  async addToVacancy(hr: User, vacancyId: number, cvId: number): Promise<HrCandidate & { pipeline: PipelineView }> {
    const vacancy = await this.vacancyService.findOwned(hr.id, vacancyId);
    if (vacancy.status !== HrVacancyStatus.OPEN) throw new BadRequestException('ვაკანსია დახურულია');

    await this.unlock(hr, cvId);
    const entry = await this.pipelineService.addToVacancy(hr.id, vacancyId, cvId);
    await this.vacancyService.touch(vacancyId);

    const [card] = await this.toCards(hr.id, [await this.findCv(hr.id, cvId)]);
    return { ...card, pipeline: toView(entry) };
  }

  /**
   * Adds someone by hand (name and position, no CV file): a private record on this HR's main board,
   * and on a vacancy's board when one is given. No quota, never in the candidate search.
   */
  async addManual(hr: User, dto: CreateManualCandidateDto): Promise<HrCandidate & { pipeline: PipelineView }> {
    let vacancyId: number | null = null;
    let position = dto.position?.trim() || '';
    if (dto.vacancyId !== undefined && dto.vacancyId !== null) {
      const vacancy = await this.vacancyService.findOwned(hr.id, dto.vacancyId);
      if (vacancy.status !== HrVacancyStatus.OPEN) throw new BadRequestException('ვაკანსია დახურულია');
      vacancyId = vacancy.id;
      // On a vacancy's board the position is that vacancy, unless the HR typed another
      position ||= vacancy.title;
    }
    if (!position) throw new BadRequestException('მიუთითეთ პოზიცია');

    const cv = await this.cvRepository.save(
      this.cvRepository.create({
        userId: null,
        email: null,
        fullName: `${dto.firstName} ${dto.lastName}`,
        phoneNumber: null,
        fileName: '',
        originalName: '',
        mimeType: '',
        size: 0,
        storagePath: '',
        summary: null,
        // Nobody else sees it, and no file was shared
        consentGiven: false,
        addedByHrId: hr.id,
        manualPosition: position,
      }),
    );
    await this.accessRepository.insert({ hrUserId: hr.id, cvId: cv.id, action: HrCvAccessAction.ADDED });
    const entry = await this.pipelineService.placeCandidate(hr.id, cv.id, vacancyId);
    if (vacancyId !== null) await this.vacancyService.touch(vacancyId);

    const [card] = await this.toCards(hr.id, [cv]);
    return { ...card, pipeline: toView(entry) };
  }

  async download(hr: User, cvId: number): Promise<{ buffer: Buffer; mimeType: string; originalName: string }> {
    const cv = await this.findCv(hr.id, cvId);
    if (!(await this.isUnlocked(hr.id, cvId))) {
      throw new ForbiddenException('Open the candidate\'s contacts before downloading the CV');
    }
    if (!cv.storagePath) throw new NotFoundException('CV file is missing');

    const buffer = await this.r2StorageService.downloadFile(cv.storagePath);
    await this.accessRepository.insert({ hrUserId: hr.id, cvId, action: HrCvAccessAction.DOWNLOAD });
    return { buffer, mimeType: cv.mimeType, originalName: cv.originalName };
  }

  /**
   * Cards of a board, newest first: every entry, one vacancy's, or the ones not in any vacancy.
   * A CV in two vacancies gives two cards. CVs deleted since the unlock drop out.
   */
  async board(hr: User, filter: BoardFilter): Promise<(HrCandidate & { pipeline: PipelineView })[]> {
    if (typeof filter === 'number') await this.vacancyService.findOwned(hr.id, filter);

    const entries = await this.pipelineService.board(hr.id, filter);
    if (!entries.length) return [];

    const ids = Array.from(new Set(entries.map((e) => e.cvId)));
    const cards = await this.toCards(hr.id, await this.cvRepository.find({ where: { id: In(ids) } }));
    const byId = new Map(cards.map((c) => [c.id, c]));
    return entries.filter((e) => byId.has(e.cvId)).map((e) => ({ ...byId.get(e.cvId)!, pipeline: toView(e) }));
  }

  async searchLinkedin(hr: User, dto: LinkedinSearchDto) {
    if (hr.role !== UserRole.ADMIN) {
      await this.limits.consume(
        linkedinQuotaKey(hr.id),
        HR_LINKEDIN_SEARCHES_PER_DAY,
        DAY_SEC,
        `LinkedIn ძიების დღიური ლიმიტი (${HR_LINKEDIN_SEARCHES_PER_DAY}) ამოიწურა, სცადეთ ხვალ`,
      );
    }
    return this.linkedinSearchService.search(dto);
  }

  async usage(hr: User) {
    return {
      cvUnlocks: { used: await this.unlocksThisMonth(hr.id), limit: HR_CV_UNLOCKS_PER_MONTH },
      linkedinSearches: { used: await this.limits.peek(linkedinQuotaKey(hr.id)), limit: HR_LINKEDIN_SEARCHES_PER_DAY },
      unlimited: hr.role === UserRole.ADMIN,
    };
  }

  /** A CV this HR may see: any in the pool, or a hand-added record of their own. */
  private async findCv(hrUserId: number, cvId: number): Promise<Cv> {
    const cv = await this.cvRepository.findOne({ where: { id: cvId } });
    if (!cv || (cv.addedByHrId !== null && cv.addedByHrId !== hrUserId)) throw new NotFoundException('Candidate not found');
    return cv;
  }

  private isUnlocked(hrUserId: number, cvId: number): Promise<boolean> {
    return this.accessRepository.exists({ where: { hrUserId, cvId, action: In(CONTACT_ACCESS) } });
  }

  private async unlocksThisMonth(hrUserId: number): Promise<number> {
    // Distinct CVs, so a double-clicked unlock never counts twice.
    const row = await this.accessRepository
      .createQueryBuilder('a')
      .select('COUNT(DISTINCT a.cvId)', 'count')
      .where('a.hrUserId = :hrUserId', { hrUserId })
      .andWhere('a.action = :action', { action: HrCvAccessAction.UNLOCK })
      .andWhere('a.createdAt >= :from', { from: startOfMonthUtc() })
      .getRawOne<{ count: string }>();
    return Number(row?.count) || 0;
  }

  private async toCards(hrUserId: number, cvs: Cv[]): Promise<HrCandidate[]> {
    if (!cvs.length) return [];

    const unlockedRows = await this.accessRepository.find({
      where: { hrUserId, cvId: In(cvs.map((cv) => cv.id)), action: In(CONTACT_ACCESS) },
      select: ['cvId'],
    });
    const unlocked = new Set(unlockedRows.map((r) => r.cvId));

    // Account CVs keep the name/email on the user, public CVs on the CV row itself.
    const userIds = cvs.filter((cv) => unlocked.has(cv.id) && cv.userId).map((cv) => cv.userId!);
    const users = userIds.length
      ? await this.userRepository.find({ where: { id: In(userIds) }, select: ['id', 'firstName', 'lastName', 'email'] })
      : [];
    const usersById = new Map(users.map((u) => [u.id, u]));
    const memberships = await this.pipelineService.memberships(hrUserId, Array.from(unlocked));

    return cvs.map((cv) => {
      const s = cv.summary;
      const isUnlocked = unlocked.has(cv.id);
      const user = cv.userId ? usersById.get(cv.userId) : undefined;
      return {
        id: cv.id,
        detectedRole: s?.detectedRole ?? cv.manualPosition ?? '',
        seniorityLevel: s?.seniorityLevel ?? '',
        careerDirection: s?.careerDirection ?? '',
        primarySkills: s?.primarySkills ?? [],
        secondarySkills: s?.secondarySkills ?? [],
        domains: s?.domains ?? [],
        locationPreference: s?.locationPreference ?? '',
        updatedAt: cv.updatedAt,
        unlocked: isUnlocked,
        contact: isUnlocked
          ? {
              fullName: user ? `${user.firstName} ${user.lastName}`.trim() : cv.fullName,
              email: user ? user.email : cv.email,
              phoneNumber: cv.phoneNumber,
            }
          : null,
        vacancies: memberships.get(cv.id) ?? [],
        manual: cv.addedByHrId !== null,
      };
    });
  }
}
