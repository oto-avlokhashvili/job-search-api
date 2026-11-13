import { frontendUrl } from 'src/hr/interview';

/**
 * Where notifications send the user. LinkedIn postings and Job Up's own open directly; every other
 * imported vacancy opens on its Job Up page, which credits the source portal and links to the original.
 */
const DIRECT_HOSTS = ['linkedin.com', 'jobup.ge'];

function hostOf(link: string): string | null {
  try {
    return new URL(link).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function opensDirectly(link: unknown): link is string {
  if (typeof link !== 'string' || !link) return false;
  const host = hostOf(link);
  if (!host) return false;
  return DIRECT_HOSTS.some((d) => host === d || host.endsWith(`.${d}`)) || host === hostOf(frontendUrl());
}

/** Where a notification should send the user: the original (LinkedIn/Job Up) or the vacancy's Job Up page. */
export function jobPageUrl(job: { id?: number | null; link?: string | null }): string {
  if (opensDirectly(job.link)) return job.link;
  return job.id ? `${frontendUrl()}/vacancies/${job.id}` : `${frontendUrl()}/vacancies`;
}
