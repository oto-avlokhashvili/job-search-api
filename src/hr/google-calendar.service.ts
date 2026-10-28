import { BadGatewayException, BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { HrGoogleAccount } from 'src/Entities/hr-google-account.entity';
import { frontendUrl } from './interview';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const STATE_TTL_MS = 10 * 60 * 1000;

export interface CalendarEvent {
  summary: string;
  description: string;
  startsAt: Date;
  durationMin: number;
}

export interface GoogleStatus {
  connected: boolean;
  email: string | null;
}

const secret = () => process.env.GOOGLE_TOKEN_KEY || process.env.JWT_SECRET || '';
const redirectUri = () => process.env.GOOGLE_CALENDAR_REDIRECT_URL || `${frontendUrl()}/google-calendar/callback`;

// ─── Connect state ─────────────────────────────────────────────
// "<hrUserId>.<expiry>.<signature>": the callback is finished by the signed-in HR and must match,
// so nobody can attach their own Google account to someone else's board (or the reverse).

const signState = (hrUserId: number, expires: number) =>
  createHmac('sha256', secret()).update(`google-calendar:${hrUserId}:${expires}`).digest('base64url');

export const connectState = (hrUserId: number, now = Date.now()) => {
  const expires = now + STATE_TTL_MS;
  return `${hrUserId}.${expires}.${signState(hrUserId, expires)}`;
};

export function stateMatches(state: string, hrUserId: number, now = Date.now()): boolean {
  const [id, expires, signature] = state.split('.');
  if (Number(id) !== hrUserId || !(Number(expires) > now) || !signature) return false;
  const expected = Buffer.from(signState(hrUserId, Number(expires)));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// ─── Refresh token at rest ─────────────────────────────────────

const key = () => createHash('sha256').update(`google-token:${secret()}`).digest();

export function encryptToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}

export function decryptToken(value: string): string {
  const [iv, tag, data] = value.split('.').map((s) => Buffer.from(s, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** The connected account has to be connected again (token revoked, expired or missing). */
const reconnect = () =>
  new BadRequestException({ statusCode: 400, message: 'Google ანგარიში ხელახლა დააკავშირეთ', code: 'GOOGLE_RECONNECT' });

/**
 * An HR's own Google Calendar: connect it once (OAuth, calendar.events scope), then each online
 * interview gets its own event with a generated Google Meet link. Google sends no emails: the
 * candidate gets Job Up's invitation, which carries the link.
 */
@Injectable()
export class GoogleCalendarService {
  private readonly logger = new Logger(GoogleCalendarService.name);
  // Access tokens live an hour; no need to refresh on every call
  private readonly accessTokens = new Map<number, { token: string; expiresAt: number }>();

  constructor(@InjectRepository(HrGoogleAccount) private readonly accountRepository: Repository<HrGoogleAccount>) {}

  async status(hrUserId: number): Promise<GoogleStatus> {
    const account = await this.accountRepository.findOne({ where: { hrUserId } });
    return { connected: !!account, email: account?.email ?? null };
  }

  /** Google's consent page for this HR. */
  connectUrl(hrUserId: number): string {
    if (!process.env.GOOGLE_CLIENT_ID) throw new BadGatewayException('Google არ არის კონფიგურირებული');
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri(),
      response_type: 'code',
      scope: `openid email ${CALENDAR_SCOPE}`,
      // A refresh token on every consent, so reconnecting always works
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state: connectState(hrUserId),
    });
    return `${AUTH_URL}?${params}`;
  }

  /** Finishes the consent: the code Google sent back to the callback page. */
  async connect(hrUserId: number, code: string, state: string): Promise<GoogleStatus> {
    if (!stateMatches(state, hrUserId)) throw new BadRequestException('ბმული ვადაგასულია: სცადეთ თავიდან');
    const tokens = await this.tokenRequest({
      code,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }).catch(() => {
      throw new BadRequestException('Google-მა დაკავშირება არ დაადასტურა: სცადეთ თავიდან');
    });
    // People can untick the calendar box on Google's page
    if (!String(tokens.scope ?? '').split(' ').includes(CALENDAR_SCOPE)) {
      throw new BadRequestException('მონიშნეთ კალენდრის წვდომა Google-ის გვერდზე');
    }
    if (!tokens.refresh_token) throw new BadRequestException('Google-მა დაკავშირება არ დაადასტურა: სცადეთ თავიდან');

    const email = emailFromIdToken(tokens.id_token) ?? '';
    const existing = await this.accountRepository.findOne({ where: { hrUserId } });
    await this.accountRepository.save({ ...existing, hrUserId, email, refreshToken: encryptToken(tokens.refresh_token) });
    this.accessTokens.set(hrUserId, { token: tokens.access_token, expiresAt: Date.now() + (tokens.expires_in - 60) * 1000 });
    return { connected: true, email };
  }

  async disconnect(hrUserId: number): Promise<GoogleStatus> {
    const account = await this.accountRepository.findOne({ where: { hrUserId } });
    if (account) {
      await this.accountRepository.delete(account.id);
      this.accessTokens.delete(hrUserId);
      // Best effort: the app also loses access when the row is gone
      await fetch(REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: decryptToken(account.refreshToken) }),
      }).catch((error) => this.logger.warn(`Could not revoke Google token of HR ${hrUserId}: ${error.message}`));
    }
    return { connected: false, email: null };
  }

  /** Creates the interview's event with a new Meet link. */
  async createMeet(hrUserId: number, event: CalendarEvent): Promise<{ eventId: string; meetUrl: string }> {
    const body = {
      ...eventBody(event),
      conferenceData: {
        createRequest: { requestId: randomBytes(12).toString('hex'), conferenceSolutionKey: { type: 'hangoutsMeet' } },
      },
    };
    let created = await this.calendar(hrUserId, 'POST', `${EVENTS_URL}?conferenceDataVersion=1&sendUpdates=none`, body);
    // Meet links are almost always ready at once; otherwise Google finishes them a moment later
    if (!created.hangoutLink) {
      await new Promise((r) => setTimeout(r, 1500));
      created = await this.calendar(hrUserId, 'GET', `${EVENTS_URL}/${encodeURIComponent(created.id)}`);
    }
    if (!created.hangoutLink) {
      await this.deleteEvent(hrUserId, created.id).catch(() => undefined);
      throw new BadGatewayException('Google Meet ლინკი ვერ შეიქმნა: სცადეთ თავიდან');
    }
    return { eventId: created.id, meetUrl: created.hangoutLink };
  }

  /** New time, length or title; the Meet link stays the same. */
  async updateEvent(hrUserId: number, eventId: string, event: CalendarEvent) {
    await this.calendar(hrUserId, 'PATCH', `${EVENTS_URL}/${encodeURIComponent(eventId)}?sendUpdates=none`, eventBody(event));
  }

  async deleteEvent(hrUserId: number, eventId: string) {
    await this.calendar(hrUserId, 'DELETE', `${EVENTS_URL}/${encodeURIComponent(eventId)}?sendUpdates=none`, undefined, true);
  }

  // ─── Helpers ──────────────────────────────────────────────────

  private async calendar(hrUserId: number, method: string, url: string, body?: unknown, missingOk = false): Promise<any> {
    for (let attempt = 0; ; attempt++) {
      const token = await this.accessToken(hrUserId);
      const res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      }).catch((error) => {
        this.logger.error(`Google Calendar unreachable: ${error.message}`);
        throw new BadGatewayException('Google Calendar მიუწვდომელია: სცადეთ მოგვიანებით');
      });
      // Token revoked on Google's side mid-hour: refresh once
      if (res.status === 401 && attempt === 0) {
        this.accessTokens.delete(hrUserId);
        continue;
      }
      if (missingOk && (res.status === 404 || res.status === 410)) return null;
      if (!res.ok) {
        this.logger.error(`Google Calendar ${method} failed for HR ${hrUserId}: ${res.status} ${await res.text()}`);
        if (res.status === 401 || res.status === 403) throw reconnect();
        throw new BadGatewayException('Google Calendar-მა მოთხოვნა ვერ შეასრულა: სცადეთ მოგვიანებით');
      }
      return res.status === 204 ? null : res.json();
    }
  }

  private async accessToken(hrUserId: number): Promise<string> {
    const cached = this.accessTokens.get(hrUserId);
    if (cached && cached.expiresAt > Date.now()) return cached.token;
    const account = await this.accountRepository.findOne({ where: { hrUserId } });
    if (!account) throw reconnect();
    let tokens: any;
    try {
      tokens = await this.tokenRequest({ refresh_token: decryptToken(account.refreshToken), grant_type: 'refresh_token' });
    } catch (error) {
      if (error instanceof GoogleTokenError && error.code === 'invalid_grant') {
        // Revoked in the Google account or expired: the stored token is useless
        await this.accountRepository.delete(account.id);
        throw reconnect();
      }
      this.logger.error(`Could not refresh Google token of HR ${hrUserId}: ${error.message}`);
      throw new BadGatewayException('Google Calendar მიუწვდომელია: სცადეთ მოგვიანებით');
    }
    this.accessTokens.set(hrUserId, { token: tokens.access_token, expiresAt: Date.now() + (tokens.expires_in - 60) * 1000 });
    return tokens.access_token;
  }

  private async tokenRequest(params: Record<string, string>): Promise<any> {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID ?? '', client_secret: process.env.GOOGLE_SECRET ?? '', ...params }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new GoogleTokenError(data.error ?? `HTTP ${res.status}`);
    return data;
  }
}

class GoogleTokenError extends Error {
  constructor(readonly code: string) {
    super(`Google token request failed: ${code}`);
  }
}

function eventBody(event: CalendarEvent) {
  const end = new Date(event.startsAt.getTime() + event.durationMin * 60 * 1000);
  return {
    summary: event.summary,
    description: event.description,
    start: { dateTime: event.startsAt.toISOString() },
    end: { dateTime: end.toISOString() },
  };
}

/** The account's email from the ID token Google just returned over TLS (no signature check needed). */
function emailFromIdToken(idToken: string | undefined): string | null {
  try {
    return JSON.parse(Buffer.from(idToken!.split('.')[1], 'base64url').toString('utf8')).email ?? null;
  } catch {
    return null;
  }
}
