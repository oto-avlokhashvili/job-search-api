/**
 * Finds the address a vacancy asks candidates to send their CV to, for quick apply.
 * Text matching only. Returns '' when the description names no usable address.
 *
 * Scraped descriptions glue addresses to the following text ("hr@x.geDeadline",
 * "hiring@lb.ge.Subject", "hr@x.geსაგანში"), so the domain is cut at its top-level domain.
 */

// Top-level domains (and second-level parts like "com" in "com.ge") seen in the vacancies
const TLDS = new Set([
  'ge', 'com', 'net', 'org', 'io', 'co', 'ru', 'ua', 'am', 'az', 'tr', 'ae', 'uk', 'de', 'fr', 'it', 'es', 'nl',
  'pl', 'cz', 'at', 'ch', 'be', 'se', 'no', 'dk', 'fi', 'ee', 'lv', 'lt', 'il', 'kz', 'by', 'us', 'ca', 'au',
  'eu', 'info', 'biz', 'me', 'app', 'dev', 'tech', 'pro', 'edu', 'gov', 'ai', 'cloud', 'online', 'group',
  'agency', 'global', 'travel', 'store', 'shop', 'xyz', 'studio', 'digital', 'jobs', 'careers', 'hr',
]);

// Not the employer's mailbox: the job sites themselves and placeholders
const BLOCKED_DOMAINS = new Set([
  'jobs.ge', 'hr.ge', 'myjobs.ge', 'awork.ge', 'cv.ge', 'linkedin.com', 'example.com', 'email.com', 'domain.com',
  'mail.com', 'sentry.io',
]);

// Mailboxes that never take applications (data-protection officers, robots, ...)
const BLOCKED_LOCAL =
  /^(no-?reply|do-?not-?reply|donotreply|privacy|p?dpo|pdp([._-]?officer)?|personal-?data|gdpr|data-?protection|abuse|security|legal|billing|press|postmaster|webmaster|mailer-daemon|complaints?)$/;

// File names that look like addresses ("logo@2x.png")
const FILE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'pdf', 'doc', 'docx']);

// Mailbox names that are clearly for hiring, and ones that clearly aren't
const HIRING_LOCAL = /(^|[._-])(hr|jobs?|careers?|vacanc(y|ies)|vakansia|cv|recruit(ment|ing)?|hiring|talents?|resumes?|apply|personnel|kadrebi)([._-]|\d|$)|^hr/;
const OTHER_LOCAL = /^(reservations?|booking|sales|support|marketing|press|media|orders?)$/;

// Words that come right before the address the CV should go to
const SEND_CV_CONTEXT = /(cv|რეზიუმე|resume|résumé|გამოაგზავნ|გადმოაგზავნ|გამოგვიგზავნ|გაგვიზიარ|მოგვაწოდ|send|apply|submit|ელ\.?\s?-?ფოსტ|ელფოსტ|მეილ|მისამართზე|e-?mail)/i;
const CONTEXT_CHARS = 150;

const ADDRESS = /[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

/** The address cut where its domain really ends, lowercased; null when it isn't a real address. */
export function cleanAddress(raw: string): string | null {
  const at = raw.indexOf('@');
  const local = raw.slice(0, at).replace(/^[._%+-]+|[._%+-]+$/g, '');
  const labels = raw.slice(at + 1).split('.');
  if (!local || labels.length < 2 || !labels[0]) return null;

  let end = -1;
  for (let i = 1; i < labels.length; i++) {
    const label = labels[i].toLowerCase();
    if (TLDS.has(label)) {
      // "com" in "mail.com.ge" is not the end yet
      if (i + 1 < labels.length && TLDS.has(labels[i + 1].toLowerCase())) continue;
      end = i;
      break;
    }
    // Glued to a capitalized word: "ziraatbank.geDeadline"
    const glued = labels[i].match(/^([a-z]{2,4})[A-Z]/);
    if (glued && TLDS.has(glued[1])) {
      labels[i] = glued[1];
      end = i;
      break;
    }
  }
  if (end === -1) {
    // An unknown but plausible top-level domain, when it's the last part
    const last = labels[labels.length - 1];
    if (!/^[A-Za-z]{2,6}$/.test(last) || FILE_EXTENSIONS.has(last.toLowerCase())) return null;
    end = labels.length - 1;
  }

  const domain = labels.slice(0, end + 1).join('.').toLowerCase();
  if (domain.split('.').some((label) => !label || label.startsWith('-') || label.endsWith('-'))) return null;
  return `${local.toLowerCase()}@${domain}`;
}

const isBlocked = (address: string) => {
  const [local, domain] = address.split('@');
  return BLOCKED_LOCAL.test(local) || BLOCKED_DOMAINS.has(domain) || [...BLOCKED_DOMAINS].some((d) => domain.endsWith(`.${d}`));
};

/** Highest-scoring address: asked for next to "send your CV", a hiring mailbox; the first one on a tie. */
export function extractApplyEmail(description: string | null | undefined): string {
  if (!description) return '';

  let best = '';
  let bestScore = -Infinity;
  const seen = new Set<string>();
  for (const match of description.matchAll(ADDRESS)) {
    const address = cleanAddress(match[0]);
    if (!address || seen.has(address) || isBlocked(address)) continue;
    seen.add(address);

    const local = address.split('@')[0];
    const before = description.slice(Math.max(0, match.index - CONTEXT_CHARS), match.index);
    let score = 0;
    if (SEND_CV_CONTEXT.test(before)) score += 3;
    if (HIRING_LOCAL.test(local)) score += 2;
    if (OTHER_LOCAL.test(local)) score -= 1;

    if (score > bestScore) {
      best = address;
      bestScore = score;
    }
  }
  return best;
}
