import { frontendUrl } from 'src/hr/interview';

/**
 * Where notifications send the user: the vacancy's original post (hr.ge, jobs.ge, LinkedIn, ...).
 * Job Up has no page per vacancy, so a job without a usable link sends the user to the search (home).
 */
export function jobPageUrl(job: { id?: number | null; link?: string | null }): string {
  return sourceUrl(job.link) ?? `${frontendUrl()}/home`;
}

/** The link only when it's a real web address: scraped data can hold anything. */
function sourceUrl(link: unknown): string | null {
  if (typeof link !== 'string' || !link) return null;
  try {
    const url = new URL(link);
    return url.protocol === 'https:' || url.protocol === 'http:' ? link : null;
  } catch {
    return null;
  }
}
