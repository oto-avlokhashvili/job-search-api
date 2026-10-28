import { BadRequestException } from '@nestjs/common';
import { HrGoogleAccount } from 'src/Entities/hr-google-account.entity';
import { connectState, decryptToken, encryptToken, GoogleCalendarService, stateMatches } from './google-calendar.service';

const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
const idToken = (email: string) => `x.${Buffer.from(JSON.stringify({ email })).toString('base64url')}.y`;

function setup(account: Partial<HrGoogleAccount> | null = null) {
  process.env.JWT_SECRET = 'test-secret';
  process.env.GOOGLE_CLIENT_ID = 'client';
  process.env.GOOGLE_SECRET = 'secret';
  process.env.FRONTEND_URL = 'https://jobup.ge';
  let row = account ? ({ id: 1, hrUserId: 7, email: 'hr@gmail.com', ...account } as HrGoogleAccount) : null;
  const repo = {
    findOne: jest.fn(async () => row),
    save: jest.fn(async (v: any) => (row = { id: 1, ...v })),
    delete: jest.fn(async () => (row = null)),
  };
  const fetchMock = jest.fn();
  global.fetch = fetchMock as any;
  return { service: new GoogleCalendarService(repo as any), repo, fetchMock, row: () => row };
}

describe('GoogleCalendarService', () => {
  it('state only works for the HR who started connecting, and only for a while', () => {
    process.env.JWT_SECRET = 'test-secret';
    const state = connectState(7);
    expect(stateMatches(state, 7)).toBe(true);
    expect(stateMatches(state, 8)).toBe(false);
    expect(stateMatches(state.replace(/^7\./, '8.'), 8)).toBe(false);
    expect(stateMatches(state, 7, Date.now() + 11 * 60 * 1000)).toBe(false);
  });

  it('keeps the refresh token encrypted', () => {
    process.env.JWT_SECRET = 'test-secret';
    const stored = encryptToken('1//refresh');
    expect(stored).not.toContain('refresh');
    expect(decryptToken(stored)).toBe('1//refresh');
  });

  it('connects: asks Google for calendar access and the frontend callback, stores the account', async () => {
    const { service, fetchMock, row } = setup();
    const url = new URL(service.connectUrl(7));
    expect(url.searchParams.get('redirect_uri')).toBe('https://jobup.ge/google-calendar/callback');
    expect(url.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/calendar.events');
    expect(url.searchParams.get('access_type')).toBe('offline');

    fetchMock.mockResolvedValueOnce(
      json(200, { access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: 'openid email https://www.googleapis.com/auth/calendar.events', id_token: idToken('hr@gmail.com') }),
    );
    await expect(service.connect(7, 'code', url.searchParams.get('state')!)).resolves.toEqual({ connected: true, email: 'hr@gmail.com' });
    expect(decryptToken(row()!.refreshToken)).toBe('rt');
  });

  it("refuses someone else's state and a consent without the calendar box ticked", async () => {
    const { service, fetchMock } = setup();
    await expect(service.connect(7, 'code', connectState(8))).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(json(200, { access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: 'openid email' }));
    await expect(service.connect(7, 'code', connectState(7))).rejects.toThrow('კალენდრის');
  });

  it('creates an event with its own Meet link and no Google emails', async () => {
    const { service, fetchMock } = setup({ refreshToken: encryptToken('rt') });
    fetchMock
      .mockResolvedValueOnce(json(200, { access_token: 'at', expires_in: 3600 }))
      .mockResolvedValueOnce(json(200, { id: 'ev1', hangoutLink: 'https://meet.google.com/abc' }));
    const startsAt = new Date('2026-11-02T08:00:00Z');
    await expect(service.createMeet(7, { summary: 's', description: 'd', startsAt, durationMin: 45 })).resolves.toEqual({
      eventId: 'ev1',
      meetUrl: 'https://meet.google.com/abc',
    });
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toContain('conferenceDataVersion=1');
    expect(url).toContain('sendUpdates=none');
    const body = JSON.parse(init.body);
    expect(body.conferenceData.createRequest.conferenceSolutionKey.type).toBe('hangoutsMeet');
    expect(body.end.dateTime).toBe('2026-11-02T08:45:00.000Z');
    expect(body.attendees).toBeUndefined();
  });

  it('a revoked token forgets the account and asks to reconnect', async () => {
    const { service, fetchMock, row } = setup({ refreshToken: encryptToken('rt') });
    fetchMock.mockResolvedValueOnce(json(400, { error: 'invalid_grant' }));
    await expect(service.createMeet(7, { summary: 's', description: '', startsAt: new Date(), durationMin: 30 })).rejects.toThrow('ხელახლა');
    expect(row()).toBeNull();
  });
});
