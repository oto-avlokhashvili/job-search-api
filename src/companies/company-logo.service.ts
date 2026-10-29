import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import { In, IsNull, Repository } from 'typeorm';
import { CompanyEntity, LogoStatus } from 'src/Entities/company.entity';
import { JobEntity } from 'src/Entities/job.entity';
import { companyKey } from './company-key';
import {
  bestPerKey,
  findJobsGeLogo,
  isJobsGeCompanyPage,
  LogoCandidate,
  MAX_LOGO_BYTES,
  processLogo,
  qualityOf,
  shouldTake,
} from './company-logo';
import { LogoStorageService } from './logo-storage.service';

export const COMPANY_LOGO_QUEUE = 'company-logo';
export interface CompanyLogoJob {
  companyId: number;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const BACKFILL_BATCH = 2000;

/**
 * Company logos: scrapers report the logo each source shows; every company gets one, downloaded once
 * (in the queue), resized, stored in the public R2 bucket and copied onto its vacancies (job.companyLogo).
 */
@Injectable()
export class CompanyLogoService implements OnModuleInit {
  private readonly logger = new Logger(CompanyLogoService.name);

  constructor(
    @InjectRepository(CompanyEntity) private readonly companyRepository: Repository<CompanyEntity>,
    @InjectRepository(JobEntity) private readonly jobRepository: Repository<JobEntity>,
    @InjectQueue(COMPANY_LOGO_QUEUE) private readonly queue: Queue,
    private readonly storage: LogoStorageService,
  ) {}

  /** Vacancies saved before logos existed get their company key (and a companies row) once. */
  async onModuleInit() {
    try {
      let total = 0;
      for (;;) {
        const rows = await this.jobRepository.find({ where: { companyKey: IsNull() }, select: ['id', 'company'], take: BACKFILL_BATCH });
        if (!rows.length) break;
        const keys = rows.map((r) => companyKey(r.company));
        await this.jobRepository.query(
          `UPDATE job_entity AS j SET "companyKey" = v.key
           FROM (SELECT unnest($1::int[]) AS id, unnest($2::text[]) AS key) v WHERE j.id = v.id`,
          [rows.map((r) => r.id), keys],
        );
        await this.ensureCompanies(rows.map((r, i) => ({ key: keys[i], name: r.company })));
        total += rows.length;
        if (rows.length < BACKFILL_BATCH) break;
      }
      if (total) this.logger.log(`Linked ${total} existing vacancies to companies`);
    } catch (error) {
      this.logger.error(`Company backfill failed: ${error.message}`);
    }
  }

  /**
   * After a scrape: makes sure every company has a row, queues logos worth downloading
   * (new company, better source, or a changed logo) and fills logos already known into new vacancies.
   */
  async register(companies: string[], candidates: LogoCandidate[]): Promise<void> {
    const named = companies.map((name) => ({ key: companyKey(name), name }));
    await this.ensureCompanies(named);

    const keyed = candidates
      .map((c) => ({ ...c, key: companyKey(c.company) }))
      .filter((c) => c.key && /^https?:\/\//.test(c.url));
    const best = bestPerKey(keyed);
    if (best.size && this.storage.enabled) {
      const existing = await this.companyRepository.find({ where: { key: In([...best.keys()]) } });
      const byKey = new Map(existing.map((c) => [c.key, c]));
      let queued = 0;
      for (const [key, candidate] of best) {
        const company = byKey.get(key);
        if (!company || !shouldTake(company, candidate)) continue;
        await this.companyRepository.update(company.id, {
          logoStatus: LogoStatus.PENDING,
          logoSourceUrl: candidate.url,
          logoSource: candidate.source,
        });
        await this.enqueue(company.id, candidate.url);
        queued++;
      }
      if (queued) this.logger.log(`Queued ${queued} company logos`);
    }

    await this.linkJobs(named.map((n) => n.key));
  }

  /** Copies known logos onto vacancies of the given companies that don't show them yet. */
  async linkJobs(keys: string[]): Promise<void> {
    const unique = [...new Set(keys.filter(Boolean))];
    if (!unique.length) return;
    await this.jobRepository.query(
      `UPDATE job_entity AS j SET "companyLogo" = c."logoUrl"
       FROM companies c
       WHERE j."companyKey" = c.key AND c."logoUrl" IS NOT NULL
         AND j."companyLogo" IS DISTINCT FROM c."logoUrl" AND c.key = ANY($1::text[])`,
      [unique],
    );
  }

  /** Queue worker: download, resize, upload, then show it on the company's vacancies. */
  async process(companyId: number): Promise<void> {
    // e.g. a local instance on the shared Redis: leave the job to a worker that can upload (it stays pending)
    if (!this.storage.enabled) throw new Error('Logo storage is not configured on this instance');
    const company = await this.companyRepository.findOne({ where: { id: companyId } });
    if (!company || company.logoStatus !== LogoStatus.PENDING || !company.logoSourceUrl) return;
    const sourceUrl = company.logoSourceUrl;

    const done = (status: LogoStatus, extra: Partial<CompanyEntity> = {}) =>
      this.companyRepository.update(company.id, { logoStatus: status, logoCheckedAt: new Date(), ...extra });

    try {
      const imageUrl = isJobsGeCompanyPage(sourceUrl) ? await this.jobsGeLogoUrl(sourceUrl) : sourceUrl;
      const image = imageUrl ? await this.download(imageUrl) : null;
      const logo = image ? await processLogo(image) : null;
      if (!logo) {
        // Keep an older logo if this source's one is unusable
        await done(company.logoUrl ? LogoStatus.OK : LogoStatus.FAILED);
        return;
      }

      const base = `logos/${company.id}-${logo.hash}`;
      const logoUrl = await this.storage.putImmutable(`${base}-128.webp`, logo.small, 'image/webp');
      await this.storage.putImmutable(`${base}-256.webp`, logo.large, 'image/webp');
      await done(LogoStatus.OK, { logoUrl, logoQuality: qualityOf(company.logoSource ?? '') });
      await this.jobRepository.update({ companyKey: company.key }, { companyLogo: logoUrl });
    } catch (error) {
      this.logger.warn(`Logo for company ${company.id} (${company.name}) failed: ${error.message}`);
      await done(company.logoUrl ? LogoStatus.OK : LogoStatus.FAILED);
    }
  }

  private async ensureCompanies(named: { key: string; name: string }[]) {
    const unique = new Map<string, string>();
    for (const { key, name } of named) if (key && !unique.has(key)) unique.set(key, name.trim().slice(0, 255));
    if (!unique.size) return;
    const rows = [...unique].map(([key, name]) => ({ key, name }));
    for (let i = 0; i < rows.length; i += 1000) {
      await this.companyRepository.createQueryBuilder().insert().values(rows.slice(i, i + 1000)).orIgnore().execute();
    }
  }

  private async enqueue(companyId: number, url: string) {
    const urlHash = createHash('sha1').update(url).digest('hex').slice(0, 10);
    await this.queue
      .add('download', { companyId } satisfies CompanyLogoJob, {
        // One job per company and logo URL: a second scrape before it runs doesn't add another
        jobId: `logo-${companyId}-${urlHash}`,
        removeOnComplete: true,
        // Not kept: a company left pending is queued again with the same id (see shouldTake)
        removeOnFail: true,
      })
      .catch((error) => this.logger.error(`Could not queue logo for company ${companyId}: ${error.message}`));
  }

  private async jobsGeLogoUrl(pageUrl: string): Promise<string | null> {
    const res = await fetch(pageUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    return res.ok ? findJobsGeLogo(await res.text(), pageUrl) : null;
  }

  /** The image, or null when it isn't one (or is too big). Network errors throw. */
  private async download(url: string): Promise<Buffer | null> {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (!type.startsWith('image/') || type.includes('svg')) return null;
    if (Number(res.headers.get('content-length') ?? 0) > MAX_LOGO_BYTES) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    return buffer.length > MAX_LOGO_BYTES ? null : buffer;
  }
}
