import { frontendUrl } from 'src/hr/interview';
import { extractApplyEmail } from './apply-email';

/**
 * Which vacancy links may leave the API. LinkedIn postings and Job Up's own keep their original
 * link, and so do hr.ge vacancies without an email to quick-apply to (applying on hr.ge is then the
 * way in). Every other portal's link stays in the database (scrapers, dedup, quick apply) and is
 * never sent to a browser, a Telegram chat or an email.
 */
const ALLOWED_HOSTS = ['linkedin.com', 'jobup.ge'];

// Shown only when the vacancy names no email (see stripHiddenLinks)
const APPLY_ON_PORTAL_HOSTS = ['hr.ge'];

// Portal hosts we import from: hidden wherever a `link` shows up, not just on vacancy objects
const PORTAL_HOSTS = ['jobs.ge', 'hr.ge', 'cv.ge', 'doctor.ge', 'chefs.ge', 'awork.ge', 'myjobs.ge'];

function hostOf(link: string): string | null {
  try {
    return new URL(link).hostname.toLowerCase();
  } catch {
    return null;
  }
}

const matchesHost = (host: string, domains: string[]) => domains.some((d) => host === d || host.endsWith(`.${d}`));

/** True when this vacancy link may be shown to users (LinkedIn or Job Up). */
export function isPublicJobLink(link: unknown): boolean {
  if (typeof link !== 'string' || !link) return false;
  const host = hostOf(link);
  if (host) return matchesHost(host, ALLOWED_HOSTS) || host === hostOf(frontendUrl());
  // Not a full URL: only Job Up's own relative paths are fine
  return link.startsWith('/');
}

/** True when the link points at one of the portals we import vacancies from. */
export function isPortalLink(link: unknown): boolean {
  if (typeof link !== 'string' || !link) return false;
  const host = hostOf(link);
  return !!host && matchesHost(host, PORTAL_HOSTS);
}

/** The vacancy's link as users may see it: the original for LinkedIn/Job Up, else null. */
export function publicJobLink(link: unknown): string | null {
  return isPublicJobLink(link) ? (link as string) : null;
}

/** Where a notification should send the user: the original (LinkedIn/Job Up) or the vacancy's Job Up page. */
export function jobPageUrl(job: { id?: number | null; link?: string | null }): string {
  const link = publicJobLink(job.link);
  if (link && !link.startsWith('/')) return link;
  return job.id ? `${frontendUrl()}/vacancies/${job.id}` : `${frontendUrl()}/vacancies`;
}

const JOB_KEYS = ['vacancy', 'company', 'publishDate', 'deadline'];

/**
 * An hr.ge vacancy with no email to quick-apply to: its hr.ge page is where people apply. Needs the
 * vacancy's applyEmail ('' = none), or its description when that isn't worked out yet; without
 * either we can't tell, so the link stays hidden.
 */
function appliesOnPortal(job: Record<string, unknown>): boolean {
  const host = typeof job.link === 'string' ? hostOf(job.link) : null;
  if (!host || !matchesHost(host, APPLY_ON_PORTAL_HOSTS)) return false;
  if (typeof job.applyEmail === 'string') return job.applyEmail === '';
  if (typeof job.description === 'string') return extractApplyEmail(job.description) === '';
  return false;
}

/**
 * A copy of an API response without hidden vacancy links. Objects shaped like a vacancy get
 * `link: null` unless it's LinkedIn/Job Up, or hr.ge without an email (appliesOnPortal); any other
 * object loses a `link` pointing at a portal. Never mutates its input (services cache job lists).
 */
export function stripHiddenLinks<T>(value: T, depth = 0): T {
  if (depth > 12 || value === null || typeof value !== 'object') return value;
  if (value instanceof Date || Buffer.isBuffer(value)) return value;
  if (Array.isArray(value)) return value.map((v) => stripHiddenLinks(v, depth + 1)) as unknown as T;
  // Streams, files and other non-plain values pass through untouched
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null && !isEntityLike(value)) return value;

  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(src)) out[key] = stripHiddenLinks(src[key], depth + 1);

  if ('link' in src) {
    const jobShaped = JOB_KEYS.some((k) => k in src);
    const hidden = jobShaped ? !isPublicJobLink(src.link) && !appliesOnPortal(src) : isPortalLink(src.link);
    if (hidden) out.link = null;
  }
  return out as T;
}

// TypeORM entities are class instances; JSON-serialise them like plain objects
function isEntityLike(value: object): boolean {
  return typeof (value as { pipe?: unknown }).pipe !== 'function' && typeof (value as { toJSON?: unknown }).toJSON !== 'function';
}
