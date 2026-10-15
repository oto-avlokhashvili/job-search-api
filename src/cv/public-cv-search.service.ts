import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { createHash } from 'crypto';
import { Cv } from 'src/Entities/cv.entity';
import { JobEntity } from 'src/Entities/job.entity';
import { JobService } from 'src/job/job.service';
import { CvSummaryDetails } from './dto/cv-summary.dto';
import { PublicCvLimitsService } from './public-cv-limits.service';

export const PUBLIC_CV_SEARCHES_PER_HOUR = 30;
const RESULT_CACHE_SEC = 3600;
const MIN_MATCH = 30;
const MAX_RESULTS = 30;

export interface PublicCvMatchedJob {
  id: number;
  vacancy: string;
  company: string;
  location: string;
  link: string;
  publishDate: string;
  deadline: string;
  page: number;
  match: number;
  matchedKeywords: string[];
}

export interface PublicCvSearchResult {
  profile: { detectedRole: string; seniorityLevel: string };
  total: number;
  jobs: PublicCvMatchedJob[];
}

export function hashSearchToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-word match that also treats Georgian letters as word characters. */
function containsWord(text: string, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return false;
  return new RegExp(`(^|[^a-z0-9\\u10A0-\\u10FF])${escapeRegex(t)}($|[^a-z0-9\\u10A0-\\u10FF])`, 'i').test(text);
}

const SENIORITY_WORDS: Record<string, string[]> = {
  Junior: ['junior', 'intern', 'trainee', 'უმცროსი', 'სტაჟიორი'],
  Mid: ['middle', 'mid-level', 'mid'],
  Senior: ['senior', 'უფროსი'],
  Lead: ['lead', 'head of', 'principal', 'architect', 'ხელმძღვანელი'],
  Principal: ['principal', 'architect', 'head of'],
};
const LEVEL_ORDER = ['Junior', 'Mid', 'Senior', 'Lead', 'Principal'];

/**
 * Deterministic CV-to-job score (0-100), no AI call: role/title fit (50), skills (35),
 * seniority (10, negative when the title is clearly 2+ levels off), location (5).
 */
export function scoreJobForCv(
  job: Pick<JobEntity, 'vacancy' | 'description' | 'location'>,
  summary: CvSummaryDetails,
): { match: number; matchedKeywords: string[] } {
  const title = (job.vacancy || '').toLowerCase();
  const body = `${title} ${(job.description || '').toLowerCase()}`;
  const keywords = new Set<string>();
  let score = 0;

  // Role / title fit
  const queryInTitle = (summary.searchQueries || []).find((q) => containsWord(title, q));
  if (queryInTitle) {
    score += 50;
    keywords.add(queryInTitle.toLowerCase());
  } else {
    const roleTokens = (summary.detectedRole || '')
      .toLowerCase()
      .split(/[\s/,-]+/)
      .filter((t) => t.length > 2);
    const hits = roleTokens.filter((t) => containsWord(title, t));
    if (roleTokens.length > 0 && hits.length > 0) {
      score += Math.round((hits.length / roleTokens.length) * 35);
      hits.forEach((h) => keywords.add(h));
    }
  }

  // Skills
  const primaryHits = (summary.primarySkills || []).filter((s) => containsWord(body, s));
  const secondaryHits = (summary.secondarySkills || []).filter((s) => containsWord(body, s));
  score += Math.min(primaryHits.length * 8, 28) + Math.min(secondaryHits.length * 3, 7);
  [...primaryHits, ...secondaryHits].forEach((s) => keywords.add(s.toLowerCase()));

  // Seniority
  const candidateLevel = LEVEL_ORDER.indexOf(summary.seniorityLevel);
  const titleLevels = LEVEL_ORDER.filter((lvl) => SENIORITY_WORDS[lvl].some((w) => containsWord(title, w)));
  if (titleLevels.length === 0 || candidateLevel < 0) {
    score += 5;
  } else {
    const distance = Math.min(...titleLevels.map((lvl) => Math.abs(LEVEL_ORDER.indexOf(lvl) - candidateLevel)));
    score += distance === 0 ? 10 : distance === 1 ? 4 : -15;
  }

  // Location
  const pref = (summary.locationPreference || '').toLowerCase();
  const jobLocation = (job.location || '').toLowerCase();
  if (pref && pref !== 'not specified' && jobLocation.includes(pref)) score += 5;
  else if (/remote|დისტანციურ/.test(jobLocation)) score += 5;

  return {
    match: Math.max(0, Math.min(100, score)),
    matchedKeywords: Array.from(keywords).slice(0, 6),
  };
}

@Injectable()
export class PublicCvSearchService {
  constructor(
    @InjectRepository(Cv)
    private readonly cvRepository: Repository<Cv>,
    private readonly jobService: JobService,
    private readonly limits: PublicCvLimitsService,
  ) {}

  async search(token: string | undefined): Promise<PublicCvSearchResult> {
    if (typeof token !== 'string' || !token) throw new UnauthorizedException('CV ვერ მოიძებნა, ატვირთეთ თავიდან');

    const cv = await this.cvRepository.findOne({
      where: { searchTokenHash: hashSearchToken(token), userId: IsNull() },
    });
    if (!cv) throw new UnauthorizedException('CV ვერ მოიძებნა, ატვირთეთ თავიდან');

    await this.limits.consume(
      `search:cv:${cv.id}`,
      PUBLIC_CV_SEARCHES_PER_HOUR,
      3600,
      'ძიების ლიმიტი ამოიწურა, სცადეთ მოგვიანებით',
    );

    const summary = cv.summary;
    if (!summary?.searchQueries?.length) {
      throw new ConflictException('CV-ის ანალიზი ვერ მოხერხდა, ატვირთეთ CV თავიდან');
    }

    // Keyed on updatedAt so a re-upload never serves the previous CV's results.
    const cacheKey = `search:${cv.id}:${cv.updatedAt.getTime()}`;
    let ranked = await this.limits.getJson<PublicCvMatchedJob[]>(cacheKey);
    if (!ranked) {
      const candidates = await this.jobService.findAllByQuery(summary.searchQueries);
      ranked = candidates
        .map((job) => ({ job, ...scoreJobForCv(job, summary) }))
        .filter((r) => r.match >= MIN_MATCH)
        .sort((a, b) => b.match - a.match)
        .slice(0, MAX_RESULTS)
        .map(({ job, match, matchedKeywords }) => ({
          id: job.id,
          vacancy: job.vacancy,
          company: job.company,
          location: job.location,
          link: job.link,
          publishDate: job.publishDate,
          deadline: job.deadline,
          page: job.page,
          match,
          matchedKeywords,
        }));
      await this.limits.setJson(cacheKey, ranked, RESULT_CACHE_SEC);
    }

    return {
      profile: { detectedRole: summary.detectedRole, seniorityLevel: summary.seniorityLevel },
      total: ranked.length,
      jobs: ranked,
    };
  }
}
