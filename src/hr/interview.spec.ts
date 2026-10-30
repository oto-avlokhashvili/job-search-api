import { InterviewFormat, InterviewStatus } from 'src/Entities/hr-interview.entity';
import { AnswerError, AnswerState, applyAnswer, cleanTimes, formatDate, formatShort, formatTime, linkToken, tokenId, tokenMatches } from './interview';
import { buildIcs, InterviewMailData, inviteEmail } from './interview-email';

const now = new Date('2026-10-28T10:00:00Z');
const at = (iso: string) => new Date(iso);
const state = (over: Partial<AnswerState> = {}): AnswerState => ({
  status: InterviewStatus.PENDING,
  startsAt: at('2026-10-30T10:00:00Z'),
  alternatives: [at('2026-10-31T07:00:00Z')],
  proposedTimes: [],
  candidateNote: null,
  timeConflict: false,
  ...over,
});

describe('interview link', () => {
  beforeAll(() => (process.env.INTERVIEW_LINK_SECRET = 'test-secret'));

  it('round-trips and rejects tampering', () => {
    const token = linkToken(42, 'nonce-a');
    expect(tokenId(token)).toBe(42);
    expect(tokenMatches(token, 42, 'nonce-a')).toBe(true);
    // Another interview's id with this signature, or another nonce, doesn't match
    expect(tokenMatches(token.replace(/^42/, '43'), 43, 'nonce-a')).toBe(false);
    expect(tokenMatches(token, 42, 'nonce-b')).toBe(false);
    expect(tokenId('42.short')).toBeNull();
    expect(tokenId('../etc')).toBeNull();
  });
});

describe('cleanTimes', () => {
  it('keeps distinct future times, sorted', () => {
    const times = cleanTimes(['2026-11-02T10:00:00Z', '2026-11-01T10:00:00Z', '2026-11-01T10:00:00Z'], now)!;
    expect(times.map((t) => t.toISOString())).toEqual(['2026-11-01T10:00:00.000Z', '2026-11-02T10:00:00.000Z']);
  });

  it('rejects past, invalid, far-future and too many times', () => {
    expect(cleanTimes(['2026-10-27T10:00:00Z'], now)).toBeNull();
    expect(cleanTimes(['not a date'], now)).toBeNull();
    expect(cleanTimes(['2028-01-01T10:00:00Z'], now)).toBeNull();
    expect(cleanTimes(['2026-11-01T10:00:00Z', '2026-11-02T10:00:00Z', '2026-11-03T10:00:00Z', '2026-11-04T10:00:00Z'], now)).toBeNull();
  });
});

describe('applyAnswer', () => {
  it('confirms, optionally at one of the offered times', () => {
    const plain = applyAnswer(state(), { action: 'confirm' }, now);
    expect(plain.state).toMatchObject({ status: InterviewStatus.CONFIRMED, alternatives: [] });
    expect(plain.changed).toBe(true);

    const slot = applyAnswer(state(), { action: 'confirm', slot: 0 }, now);
    expect(slot.state.startsAt.toISOString()).toBe('2026-10-31T07:00:00.000Z');
    expect(() => applyAnswer(state(), { action: 'confirm', slot: 2 }, now)).toThrow(AnswerError);
  });

  it('declines with a trimmed note, and says when it is only the time', () => {
    expect(applyAnswer(state(), { action: 'decline', note: '  found   another job ' }, now).state).toMatchObject({
      status: InterviewStatus.DECLINED,
      candidateNote: 'found another job',
      timeConflict: false,
    });
    const busy = applyAnswer(state(), { action: 'decline', timeConflict: true }, now);
    expect(busy.state).toMatchObject({ status: InterviewStatus.DECLINED, timeConflict: true });
    // Ticking it after declining is a change; confirming later clears it
    expect(applyAnswer(applyAnswer(state(), { action: 'decline' }, now).state, { action: 'decline', timeConflict: true }, now).changed).toBe(true);
    expect(applyAnswer(busy.state, { action: 'confirm' }, now).state.timeConflict).toBe(false);
  });

  it('a repeated answer changes nothing; cancelled or started interviews take no answers', () => {
    const confirmed = applyAnswer(state(), { action: 'confirm' }, now).state;
    expect(applyAnswer(confirmed, { action: 'confirm' }, now).changed).toBe(false);
    // The candidate can still change their mind before it starts
    expect(applyAnswer(confirmed, { action: 'decline' }, now).changed).toBe(true);

    expect(() => applyAnswer(state({ status: InterviewStatus.CANCELLED }), { action: 'confirm' }, now)).toThrow('გაუქმებულია');
    expect(() => applyAnswer(state({ startsAt: at('2026-10-28T09:00:00Z') }), { action: 'confirm' }, now)).toThrow('გავიდა');
  });
});

describe('Georgian dates in Tbilisi time', () => {
  it('formats UTC instants as Tbilisi local time (UTC+4)', () => {
    const d = at('2026-10-29T10:00:00Z'); // Thursday 14:00 in Tbilisi
    expect(formatDate(d)).toBe('ხუთშაბათი, 29 ოქტომბერი');
    expect(formatTime(d)).toBe('14:00');
    expect(formatShort(d)).toBe('ხუთ, 29 ოქტ · 14:00');
    // Late UTC evening is already the next day in Tbilisi
    expect(formatDate(at('2026-10-29T21:30:00Z'))).toBe('პარასკევი, 30 ოქტომბერი');
  });
});

describe('interview emails', () => {
  const data: InterviewMailData = {
    id: 7,
    candidateName: 'ანი ციცქიშვილი',
    position: 'Designer <script>',
    company: 'Acme & Co',
    hrName: 'Nino',
    hrEmail: 'hr@acme.ge',
    startsAt: at('2026-10-30T10:00:00Z'),
    durationMin: 45,
    format: InterviewFormat.ONLINE,
    location: 'https://meet.google.com/abc-defg-hij',
    message: 'Bring your portfolio, please; thanks',
    alternatives: [at('2099-01-01T10:00:00Z')],
    candidateNote: null,
    timeConflict: false,
    link: 'https://jobup.ge/interview/7.sig',
    sequence: 1,
  };

  it('escapes free text and links every answer button to the answer page', () => {
    const { html, subject } = inviteEmail(data);
    expect(html).not.toContain('<script>');
    expect(html).toContain('Designer &lt;script&gt;');
    expect(html).toContain('Acme &amp; Co');
    expect(html).toContain('https://jobup.ge/interview/7.sig?a=confirm');
    expect(html).toContain('https://jobup.ge/interview/7.sig?a=decline');
    expect(html).not.toContain('a=reschedule');
    // Each offered time is its own button
    expect(html).toContain('?a=confirm&slot=0');
    expect(html).toContain('ვარიანტები');
    expect(subject).toContain('Acme & Co');
  });

  it('builds a calendar file with escaped text and folded lines', () => {
    const ics = buildIcs(data, InterviewStatus.CONFIRMED);
    expect(ics).toContain('DTSTART:20261030T100000Z');
    expect(ics).toContain('DTEND:20261030T104500Z');
    expect(ics).toContain('UID:interview-7@jobup.ge');
    expect(ics).toContain('STATUS:CONFIRMED');
    expect(ics.replace(/\r\n /g, '')).toContain('please\\; thanks');
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
  });
});
