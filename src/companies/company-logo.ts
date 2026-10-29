import { createHash } from 'crypto';
import sharp from 'sharp';
import { LogoStatus } from 'src/Entities/company.entity';

/** A logo a scraper saw for a company. */
export interface LogoCandidate {
  company: string;
  source: string;
  url: string;
}

// Big square originals beat the 100px ones; hr.ge only has small banner-shaped ones
export const SOURCE_QUALITY: Record<string, number> = { awork: 4, myjobs: 4, linkedin: 3, jobsge: 3, hrge: 1 };
// Sources whose logo URL changes only when the logo does (hr.ge has a new URL per vacancy)
const STABLE_URL_SOURCES = new Set(['awork', 'myjobs', 'linkedin', 'jobsge']);
const RETRY_FAILED_AFTER_MS = 7 * 24 * 3600 * 1000;

export const qualityOf = (source: string) => SOURCE_QUALITY[source] ?? 0;

interface CompanyLogoState {
  logoStatus: LogoStatus;
  logoSourceUrl: string | null;
  logoSource: string | null;
  logoQuality: number;
  logoCheckedAt: Date | null;
  /** When the row last changed: tells a stuck "pending" (its job was lost) from a queued one */
  updatedAt?: Date;
}

const STUCK_PENDING_MS = 24 * 3600 * 1000;

/** Whether a newly seen logo should be downloaded for the company (and replace what it has). */
export function shouldTake(company: CompanyLogoState | undefined, candidate: LogoCandidate, now = new Date()): boolean {
  if (!company) return true;
  const quality = qualityOf(candidate.source);
  const sameUrl = candidate.url === company.logoSourceUrl;

  switch (company.logoStatus) {
    case LogoStatus.NONE:
      return true;
    case LogoStatus.PENDING: {
      const stuck = !!company.updatedAt && now.getTime() - company.updatedAt.getTime() > STUCK_PENDING_MS;
      return sameUrl ? stuck : quality >= company.logoQuality;
    }
    case LogoStatus.FAILED: {
      const stale = !company.logoCheckedAt || now.getTime() - company.logoCheckedAt.getTime() > RETRY_FAILED_AFTER_MS;
      return !sameUrl || stale;
    }
    case LogoStatus.OK:
      if (quality > company.logoQuality) return true;
      // Same source, new URL: the company changed its logo there
      return (
        quality === company.logoQuality &&
        candidate.source === company.logoSource &&
        STABLE_URL_SOURCES.has(candidate.source) &&
        !sameUrl
      );
  }
}

/** One candidate per company key: the best source wins, the first one seen on a tie. */
export function bestPerKey(candidates: (LogoCandidate & { key: string })[]): Map<string, LogoCandidate & { key: string }> {
  const best = new Map<string, LogoCandidate & { key: string }>();
  for (const c of candidates) {
    const current = best.get(c.key);
    if (!current || qualityOf(c.source) > qualityOf(current.source)) best.set(c.key, c);
  }
  return best;
}

// ─── Image ─────────────────────────────────────────────────────

export const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const MIN_SIDE = 16;

export interface ProcessedLogo {
  /** Content hash, part of the file name */
  hash: string;
  small: Buffer;
  large: Buffer;
}

/**
 * Logo image → 128px and 256px WebP (fits inside the square, keeps its shape and transparency,
 * never upscaled). Null when it isn't a usable raster image (SVG, tiny, broken).
 */
export async function processLogo(input: Buffer): Promise<ProcessedLogo | null> {
  // SVG can carry scripts; only raster images are accepted
  if (input.subarray(0, 256).toString('utf8').trimStart().startsWith('<')) return null;
  try {
    const original = sharp(input, { limitInputPixels: 40_000_000, animated: false }).rotate();
    const meta = await original.metadata();
    if (!meta.width || !meta.height || meta.width < MIN_SIDE || meta.height < MIN_SIDE || meta.format === 'svg') return null;
    const image = await trimMargins(original, meta.width, meta.height);

    const resize = (side: number) =>
      image.clone().resize(side, side, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85, effort: 5 }).toBuffer();
    const [small, large] = await Promise.all([resize(128), resize(256)]);
    const hash = createHash('sha1').update(large).digest('hex').slice(0, 12);
    return { hash, small, large };
  } catch {
    return null;
  }
}

/**
 * Many sources pad logos with a wide plain margin, which makes them tiny in a small box.
 * Cut it off (keeping a thin edge); a plain or nearly empty image stays as it was.
 */
async function trimMargins(image: sharp.Sharp, width: number, height: number): Promise<sharp.Sharp> {
  try {
    const { data, info } = await image.clone().trim({ threshold: 12 }).toBuffer({ resolveWithObject: true });
    // Nothing cut (no margin), or almost nothing left
    if ((info.width >= width && info.height >= height) || info.width < MIN_SIDE || info.height < MIN_SIDE) return image;
    const pad = Math.round(Math.max(info.width, info.height) * 0.06);
    // Materialized: sharp applies extend() after resize() in one pipeline, which would break the sizes
    const padded = await sharp(data)
      .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toBuffer();
    return sharp(padded);
  } catch {
    // trim() throws when the whole image is one colour
    return image;
  }
}

/** jobs.ge: the company page's logo (100px), falling back to the small listing icon. */
export function findJobsGeLogo(html: string, pageUrl: string): string | null {
  const path = /\/data\/clients\/logo\/[^"'\s>]+/.exec(html)?.[0] ?? /\/data\/clients\/logo_icon\/[^"'\s>]+/.exec(html)?.[0];
  return path ? new URL(path, pageUrl).toString() : null;
}

export const isJobsGeCompanyPage = (url: string) => /^https?:\/\/(www\.)?jobs\.ge\/.*[?&]view=client\b/.test(url);
