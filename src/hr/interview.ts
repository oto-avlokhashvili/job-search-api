import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { InterviewStatus } from 'src/Entities/hr-interview.entity';

export const MAX_ALTERNATIVES = 3;
const YEAR_MS = 365 * 24 * 3600 * 1000;
// Answers are accepted until the interview starts
const ACTIVE = [InterviewStatus.PENDING, InterviewStatus.CONFIRMED, InterviewStatus.RESCHEDULE_REQUESTED];

export const isActive = (status: InterviewStatus) => ACTIVE.includes(status);

// ─── Candidate link ────────────────────────────────────────────
// token = "<id>.<signature>": re-derivable from the id and nonce, so the HR can copy it any time,
// while a database leak alone (no secret) can't forge one.

const secret = () => process.env.INTERVIEW_LINK_SECRET || process.env.JWT_SECRET || '';

export const newLinkNonce = () => randomBytes(12).toString('hex');

const sign = (id: number, nonce: string) =>
  createHmac('sha256', secret()).update(`interview:${id}:${nonce}`).digest('base64url').slice(0, 32);

export const linkToken = (id: number, nonce: string) => `${id}.${sign(id, nonce)}`;

/** The interview id the token claims; verify it with tokenMatches once the row is loaded. */
export function tokenId(token: string): number | null {
  const match = /^(\d{1,10})\.[A-Za-z0-9_-]{32}$/.exec(token);
  return match ? Number(match[1]) : null;
}

export function tokenMatches(token: string, id: number, nonce: string): boolean {
  const expected = Buffer.from(linkToken(id, nonce));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** The site's origin. FRONTEND_URL may carry a path (it used to point at /profile for the Google login); only the origin counts. */
export const frontendUrl = () => {
  try {
    return new URL(process.env.FRONTEND_URL || '').origin;
  } catch {
    return 'https://jobup.ge';
  }
};
export const interviewLink = (id: number, nonce: string) => `${frontendUrl()}/interview/${linkToken(id, nonce)}`;

// ─── Times ─────────────────────────────────────────────────────

/** Distinct future times within a year, sorted; null if any is invalid. */
export function cleanTimes(values: (string | Date)[], now: Date, max = MAX_ALTERNATIVES): Date[] | null {
  const times: Date[] = [];
  for (const value of values) {
    const date = new Date(value);
    const t = date.getTime();
    if (Number.isNaN(t) || t <= now.getTime() || t > now.getTime() + YEAR_MS) return null;
    if (!times.some((d) => d.getTime() === t)) times.push(date);
  }
  if (times.length > max) return null;
  return times.sort((a, b) => a.getTime() - b.getTime());
}

export const isValidStart = (date: Date, now: Date) =>
  !Number.isNaN(date.getTime()) && date.getTime() > now.getTime() && date.getTime() <= now.getTime() + YEAR_MS;

// ─── Candidate answer ──────────────────────────────────────────

export type CandidateAction = 'confirm' | 'decline' | 'reschedule';

export interface AnswerState {
  status: InterviewStatus;
  startsAt: Date;
  alternatives: Date[];
  proposedTimes: Date[];
  candidateNote: string | null;
}

export interface CandidateAnswer {
  action: CandidateAction;
  /** confirm: index of one of the HR's alternative times instead of the main one */
  slot?: number;
  note?: string | null;
  proposedTimes?: string[];
}

export class AnswerError extends Error {
  constructor(
    readonly code: 'CANCELLED' | 'PAST' | 'BAD_SLOT' | 'BAD_TIMES',
    message: string,
  ) {
    super(message);
  }
}

const cleanNote = (note?: string | null) => (note ?? '').replace(/\s+/g, ' ').trim().slice(0, 500) || null;

/**
 * Applies the candidate's answer. They can change it until the interview starts.
 * Returns the new state and whether anything changed (a repeated click changes nothing).
 */
export function applyAnswer(current: AnswerState, answer: CandidateAnswer, now: Date): { state: AnswerState; changed: boolean } {
  if (current.status === InterviewStatus.CANCELLED) {
    throw new AnswerError('CANCELLED', 'გასაუბრება გაუქმებულია');
  }
  if (current.startsAt.getTime() <= now.getTime()) {
    throw new AnswerError('PAST', 'გასაუბრების დრო უკვე გავიდა');
  }

  const state: AnswerState = { ...current };
  if (answer.action === 'confirm') {
    if (answer.slot !== undefined && answer.slot !== null) {
      const chosen = current.alternatives[answer.slot];
      if (!chosen || chosen.getTime() <= now.getTime()) throw new AnswerError('BAD_SLOT', 'ეს დრო აღარ არის ხელმისაწვდომი');
      state.startsAt = chosen;
    }
    state.status = InterviewStatus.CONFIRMED;
    state.alternatives = [];
    state.proposedTimes = [];
    state.candidateNote = null;
  } else if (answer.action === 'decline') {
    state.status = InterviewStatus.DECLINED;
    state.proposedTimes = [];
    state.candidateNote = cleanNote(answer.note);
  } else {
    const times = cleanTimes(answer.proposedTimes ?? [], now);
    if (!times || !times.length) throw new AnswerError('BAD_TIMES', 'მიუთითეთ 1-დან 3-მდე მომავალი დრო');
    state.status = InterviewStatus.RESCHEDULE_REQUESTED;
    state.proposedTimes = times;
    state.candidateNote = cleanNote(answer.note);
  }

  const sameTimes = (a: Date[], b: Date[]) => a.length === b.length && a.every((d, i) => d.getTime() === b[i].getTime());
  const changed =
    state.status !== current.status ||
    state.startsAt.getTime() !== current.startsAt.getTime() ||
    state.candidateNote !== current.candidateNote ||
    !sameTimes(state.proposedTimes, current.proposedTimes);
  return { state, changed };
}

// ─── Georgian date formatting (Tbilisi time, UTC+4 all year) ───

const TZ = 'Asia/Tbilisi';
const DAYS = ['კვირა', 'ორშაბათი', 'სამშაბათი', 'ოთხშაბათი', 'ხუთშაბათი', 'პარასკევი', 'შაბათი'];
const DAYS_SHORT = ['კვი', 'ორშ', 'სამ', 'ოთხ', 'ხუთ', 'პარ', 'შაბ'];
const MONTHS = ['იანვარი', 'თებერვალი', 'მარტი', 'აპრილი', 'მაისი', 'ივნისი', 'ივლისი', 'აგვისტო', 'სექტემბერი', 'ოქტომბერი', 'ნოემბერი', 'დეკემბერი'];

function tbilisiParts(date: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
      weekday: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { weekday, day: Number(parts.day), month: Number(parts.month) - 1, year: Number(parts.year), time: `${parts.hour}:${parts.minute}` };
}

/** "ხუთშაბათი, 30 ოქტომბერი" */
export function formatDate(date: Date): string {
  const p = tbilisiParts(date);
  return `${DAYS[p.weekday]}, ${p.day} ${MONTHS[p.month]}`;
}

/** "14:00" */
export const formatTime = (date: Date) => tbilisiParts(date).time;

/** "ხუთ, 30 ოქტ · 14:00" for compact buttons */
export function formatShort(date: Date): string {
  const p = tbilisiParts(date);
  return `${DAYS_SHORT[p.weekday]}, ${p.day} ${MONTHS[p.month].slice(0, 3)} · ${p.time}`;
}
