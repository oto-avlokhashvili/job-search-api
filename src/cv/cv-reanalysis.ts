import { Repository } from 'typeorm';
import { Cv } from 'src/Entities/cv.entity';
import { CvSummaryDetails } from './dto/cv-summary.dto';

/**
 * Re-analyzes CVs whose summary lacks the HR filter facts (employers, universities, languages, years
 * of experience): one AI call per CV, one CV at a time. Only those facts are added to an existing
 * summary, so its role, skills and a user's own edits stay; a CV without a summary gets a full one.
 *
 * Throttled to leave the AI quota for the live site: by default at most 7 CVs a minute and 500 a
 * UTC day, about half of Gemini's free tier (15/min, 1,000/day). Past the daily cap it waits for the
 * next UTC day and goes on. Failed CVs stay pending for the next run; repeated failures (likely a
 * spent quota) pause it for a while instead of burning through the queue.
 */

const envInt = (name: string, fallback: number) => Number(process.env[name]) || fallback;

export interface ReanalysisLimits {
  perMinute: number;
  perDay: number;
}

export const defaultReanalysisLimits = (): ReanalysisLimits => ({
  perMinute: envInt('REANALYZE_PER_MINUTE', 7),
  perDay: envInt('REANALYZE_PER_DAY', 500),
});

export interface ReanalysisStatus {
  running: boolean;
  /** This run: CVs re-analyzed / failed (failed ones stay pending) */
  done: number;
  failed: number;
  /** CVs still lacking the HR filter facts */
  remaining: number | null;
  /** Set while it waits: the daily cap is reached, or several calls in a row failed */
  pausedUntil: Date | null;
  limits: ReanalysisLimits;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface ReanalysisDeps {
  repo: Repository<Cv>;
  download: (storagePath: string) => Promise<Buffer>;
  summarize: (file: Express.Multer.File) => Promise<CvSummaryDetails | null>;
  logger: { log: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
  /** Stop after this many CVs (a trial run); unlimited by default */
  maxCvs?: number;
}

const FAILURE_PAUSE_MS = 60 * 1000;
const FAILURES_BEFORE_LONG_PAUSE = 5;
const LONG_PAUSE_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 2;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const utcDay = () => new Date().toISOString().slice(0, 10);
const nextUtcMidnight = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 5));
};

export class CvReanalysis {
  private state: ReanalysisStatus;

  constructor(
    private readonly deps: ReanalysisDeps,
    private readonly limits: ReanalysisLimits = defaultReanalysisLimits(),
  ) {
    this.state = this.freshState(false);
  }

  /** CVs whose summary lacks the facts (or has no summary) and have a file to read */
  pendingQuery() {
    return this.deps.repo
      .createQueryBuilder('cv')
      .where("cv.storagePath <> ''")
      .andWhere("(cv.summary IS NULL OR cv.summary->'languages' IS NULL)");
  }

  async status(): Promise<ReanalysisStatus> {
    return { ...this.state, remaining: await this.pendingQuery().getCount() };
  }

  /** Starts in the background; while running, returns the progress. The returned promise of `run` is exposed for scripts. */
  start(): { status: Promise<ReanalysisStatus>; finished: Promise<void> } {
    if (this.state.running) return { status: this.status(), finished: Promise.resolve() };
    this.state = this.freshState(true);
    const finished = this.run();
    return { status: this.status(), finished };
  }

  private freshState(running: boolean): ReanalysisStatus {
    return {
      running,
      done: 0,
      failed: 0,
      remaining: null,
      pausedUntil: null,
      limits: this.limits,
      startedAt: running ? new Date() : null,
      finishedAt: null,
    };
  }

  private async pauseUntil(until: Date) {
    this.state.pausedUntil = until;
    await sleep(Math.max(0, until.getTime() - Date.now()));
    this.state.pausedUntil = null;
  }

  private async run() {
    const { repo, download, summarize, logger, maxCvs } = this.deps;
    const gapMs = Math.ceil(60_000 / Math.max(1, this.limits.perMinute));
    // Failed CVs wait: retried once after a long pause, then left pending for the next run
    const attempts = new Map<number, number>();
    const skip: number[] = [];
    let day = utcDay();
    let usedToday = 0;
    let failuresInRow = 0;
    let processed = 0;

    try {
      for (;;) {
        if (maxCvs !== undefined && processed >= maxCvs) break;

        if (utcDay() !== day) {
          day = utcDay();
          usedToday = 0;
        }
        if (usedToday >= this.limits.perDay) {
          logger.log(`Re-analysis: daily cap of ${this.limits.perDay} reached, continuing after midnight UTC`);
          await this.pauseUntil(nextUtcMidnight());
          continue;
        }

        const qb = this.pendingQuery().orderBy('cv.id', 'ASC');
        if (skip.length) qb.andWhere('cv.id NOT IN (:...skip)', { skip });
        const cv = await qb.getOne();
        if (!cv) break;

        const startedAt = Date.now();
        usedToday++;
        processed++;
        try {
          const buffer = await download(cv.storagePath);
          const fresh = await summarize({
            buffer,
            mimetype: cv.mimeType,
            originalname: cv.originalName,
            size: buffer.length,
          } as Express.Multer.File);
          if (!fresh) throw new Error('the AI returned no summary');

          // summarizeCv has tidied them already (normalizeSummaryFacts)
          const facts = {
            companies: fresh.companies ?? [],
            universities: fresh.universities ?? [],
            languages: fresh.languages ?? [],
            yearsOfExperience: fresh.yearsOfExperience,
          };
          // The fact lists are always written (empty when the AI found none), so a CV is never picked again
          await repo.update(cv.id, { summary: { ...(cv.summary ?? fresh), ...facts } });
          this.state.done++;
          failuresInRow = 0;
          logger.log(
            `Re-analysis: CV ${cv.id} done (${this.state.done} done, ${this.state.failed} failed) ` +
              `— ${facts.universities.length} universities, ${facts.languages.length} languages, ${facts.companies.length} companies`,
          );
        } catch (e: any) {
          attempts.set(cv.id, (attempts.get(cv.id) ?? 0) + 1);
          skip.push(cv.id);
          this.state.failed++;
          failuresInRow++;
          logger.warn(`Re-analysis: CV ${cv.id} failed (${e.message})`);
          if (failuresInRow >= FAILURES_BEFORE_LONG_PAUSE) {
            logger.warn(`Re-analysis: ${failuresInRow} failures in a row, pausing ${LONG_PAUSE_MS / 60000} min (quota?)`);
            await this.pauseUntil(new Date(Date.now() + LONG_PAUSE_MS));
            failuresInRow = 0;
            // Those that failed only once get one more try after the pause
            skip.splice(0, skip.length, ...[...attempts].filter(([, n]) => n >= MAX_ATTEMPTS).map(([id]) => id));
          } else {
            await sleep(FAILURE_PAUSE_MS);
          }
          continue;
        }

        // Pace: at most perMinute CV starts a minute
        await sleep(Math.max(0, gapMs - (Date.now() - startedAt)));
      }
    } catch (e: any) {
      logger.error(`Re-analysis stopped: ${e.message}`);
    } finally {
      this.state.running = false;
      this.state.finishedAt = new Date();
      logger.log(`Re-analysis finished: ${this.state.done} done, ${this.state.failed} failed`);
    }
  }
}
