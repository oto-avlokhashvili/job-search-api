import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { User } from 'src/Entities/user.entity';
import { HrInterview, InterviewFormat, InterviewStatus } from 'src/Entities/hr-interview.entity';
import { PipelineStage } from 'src/Entities/hr-pipeline-entry.entity';
import { PipelineEventType } from 'src/Entities/hr-pipeline-event.entity';
import { HrInterviewService } from './hr-interview.service';
import { linkToken } from './interview';

const HOUR = 3600 * 1000;
const hr = { id: 7, firstName: 'Nino', lastName: 'B', email: 'hr@acme.ge', companyName: 'Acme' } as User;
const inDays = (d: number) => new Date(Date.now() + d * 24 * HOUR).toISOString();

function setup({ candidateEmail = 'ani@example.test', stage = PipelineStage.CONTACTED } = {}) {
  process.env.INTERVIEW_LINK_SECRET = 'test-secret';
  const rows: HrInterview[] = [];
  const interviews = {
    rows,
    create: (v: Partial<HrInterview>) => ({ ...v }),
    save: jest.fn(async (v: any) => {
      const existing = rows.find((r) => r.id === v.id);
      if (existing) return Object.assign(existing, v, { updatedAt: new Date() });
      const row = {
        id: rows.length + 1,
        status: InterviewStatus.PENDING,
        proposedTimes: [],
        candidateNote: null,
        respondedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...v,
      } as HrInterview;
      rows.push(row);
      return row;
    }),
    findOne: jest.fn(async ({ where }) => rows.find((r) => r.id === where.id && (!where.hrUserId || r.hrUserId === where.hrUserId)) ?? null),
    find: jest.fn(async () => rows),
    delete: jest.fn(async (id: number) => {
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) rows.splice(i, 1);
    }),
  };
  // Only the "open interview for this card" lookup passes entryId
  interviews.findOne.mockImplementation(async ({ where }) => {
    if (where.entryId) return rows.find((r) => r.entryId === where.entryId && r.status !== InterviewStatus.CANCELLED && r.startsAt > new Date()) ?? null;
    return rows.find((r) => r.id === where.id && (!where.hrUserId || r.hrUserId === where.hrUserId)) ?? null;
  });

  const entry = { id: 3, hrUserId: 7, cvId: 10, vacancyId: 4, stage, rejectionReason: null, rating: null, tags: [], position: null, updatedAt: new Date() };
  const cvs = { findOne: jest.fn(async () => ({ id: 10, userId: null, fullName: 'Ani Ts', email: candidateEmail, summary: { detectedRole: 'Designer' } })) };
  const users = { findOne: jest.fn(async () => hr) };
  const vacancies = { findOne: jest.fn(async () => ({ id: 4, title: 'Graphic Designer' })) };
  const pipeline = {
    findOwned: jest.fn(async () => entry),
    update: jest.fn(async () => ({ id: 3, vacancyId: 4, stage: PipelineStage.INTERVIEW, rejectionReason: null, rating: null, tags: [], position: null })),
    recordEvent: jest.fn(),
  };
  const email = { queueEmail: jest.fn() };
  const queue = { add: jest.fn(async () => ({})) };
  let events = 0;
  const google = {
    createMeet: jest.fn(async () => ({ eventId: `ev${++events}`, meetUrl: `https://meet.google.com/abc-defg-hi${events}` })),
    updateEvent: jest.fn(async () => undefined),
    deleteEvent: jest.fn(async () => undefined),
  };
  const service = new HrInterviewService(
    interviews as any,
    cvs as any,
    users as any,
    vacancies as any,
    pipeline as any,
    email as any,
    google as any,
    queue as any,
  );
  const draft = { startsAt: inDays(2), durationMin: 45, format: InterviewFormat.ONLINE, location: 'https://meet.example/x' };
  return { service, interviews, pipeline, email, queue, google, draft, token: () => linkToken(rows[0].id, rows[0].linkNonce) };
}

describe('HrInterviewService', () => {
  it('schedules: moves the card, records it, emails the invitation with a calendar file and the HR as Reply-To', async () => {
    const { service, pipeline, email, draft } = setup();
    const { interview, pipeline: view } = await service.schedule(hr, 3, draft);

    expect(pipeline.update).toHaveBeenCalledWith(hr, 3, { stage: PipelineStage.INTERVIEW });
    expect(view.stage).toBe(PipelineStage.INTERVIEW);
    expect(pipeline.recordEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: PipelineEventType.INTERVIEW_SCHEDULED }));
    expect(interview).toMatchObject({ status: InterviewStatus.PENDING, sentTo: 'ani@example.test' });
    expect(interview.link).toMatch(/\/interview\/1\.[A-Za-z0-9_-]{32}$/);

    const [to, subject, html, , senderName, extra] = email.queueEmail.mock.calls[0];
    expect(to).toBe('ani@example.test');
    expect(subject).toContain('Graphic Designer');
    expect(html).toContain('?a=confirm');
    expect(senderName).toBe('Acme · Job Up');
    expect(extra.replyTo).toEqual({ email: 'hr@acme.ge', name: 'Nino B' });
    expect(extra.attachments[0].name).toBe('interview.ics');
  });

  it('refuses a past time, a second open interview, and sending to a candidate without email', async () => {
    const { service, draft } = setup();
    await expect(service.schedule(hr, 3, { ...draft, startsAt: inDays(-1) })).rejects.toBeInstanceOf(BadRequestException);
    await service.schedule(hr, 3, draft);
    await expect(service.schedule(hr, 3, draft)).rejects.toBeInstanceOf(ConflictException);

    const noEmail = setup({ candidateEmail: '' });
    await expect(noEmail.service.schedule(hr, 3, noEmail.draft)).rejects.toThrow('ელ-ფოსტა');
    // ...but saving without sending works
    const saved = await noEmail.service.schedule(hr, 3, { ...noEmail.draft, send: false });
    expect(saved.interview.sentTo).toBeNull();
    expect(noEmail.email.queueEmail).not.toHaveBeenCalled();
  });

  it('a failed card move leaves no interview behind, so retrying works; a failed history line does not fail scheduling', async () => {
    const { service, interviews, pipeline, draft } = setup();
    pipeline.update.mockRejectedValueOnce(new Error('db down'));
    await expect(service.schedule(hr, 3, draft)).rejects.toThrow('db down');
    expect(interviews.rows).toHaveLength(0);

    pipeline.recordEvent.mockRejectedValueOnce(new Error('enum value missing'));
    const { interview } = await service.schedule(hr, 3, draft);
    expect(interview.status).toBe(InterviewStatus.PENDING);
    expect(interviews.rows).toHaveLength(1);
  });

  it('candidate confirms: HR is told, the candidate gets a confirmation, reminders are planned once', async () => {
    const { service, email, queue, draft, token, pipeline } = setup();
    await service.schedule(hr, 3, draft);
    email.queueEmail.mockClear();

    const view = await service.answer(token(), { action: 'confirm' });
    expect(view.status).toBe(InterviewStatus.CONFIRMED);
    expect(pipeline.recordEvent).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ type: PipelineEventType.INTERVIEW_CONFIRMED }));
    expect(email.queueEmail.mock.calls.map((c) => c[0])).toEqual(['hr@acme.ge', 'ani@example.test']);
    expect(queue.add).toHaveBeenCalledTimes(2);
    const delays = queue.add.mock.calls.map((c: any[]) => c[2].delay).sort((a, b) => a - b);
    expect(delays[0]).toBeGreaterThan(23 * HOUR);
    expect(delays[1]).toBeGreaterThan(46 * HOUR);

    // Clicking confirm again sends nothing new
    await service.answer(token(), { action: 'confirm' });
    expect(email.queueEmail).toHaveBeenCalledTimes(2);
  });

  it('rejects a forged or unknown link', async () => {
    const { service, draft, token } = setup();
    await service.schedule(hr, 3, draft);
    const forged = token().slice(0, -1) + (token().endsWith('A') ? 'B' : 'A');
    await expect(service.publicView(forged)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.publicView('nonsense')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('HR accepts a proposed time; cancelling emails the candidate only if they were invited', async () => {
    const { service, email, draft, token } = setup();
    await service.schedule(hr, 3, draft);
    const proposed = inDays(4);
    await service.answer(token(), { action: 'reschedule', proposedTimes: [proposed] });

    const accepted = await service.update(hr, 1, { acceptProposed: 0 });
    expect(accepted).toMatchObject({ status: InterviewStatus.CONFIRMED, proposedTimes: [] });
    expect(new Date(accepted.startsAt).toISOString()).toBe(proposed);

    email.queueEmail.mockClear();
    const cancelled = await service.update(hr, 1, { cancel: true });
    expect(cancelled.status).toBe(InterviewStatus.CANCELLED);
    expect(email.queueEmail).toHaveBeenCalledTimes(1);
    expect(email.queueEmail.mock.calls[0][1]).toContain('გაუქმდა');
    await expect(service.answer(token(), { action: 'confirm' })).rejects.toThrow('გაუქმებულია');
  });

  it('Google Meet: each interview gets its own link, emailed to the candidate; the event follows reschedules and cancels', async () => {
    const { service, email, google, draft } = setup();
    const { interview } = await service.schedule(hr, 3, { ...draft, location: '', googleMeet: true });
    expect(interview).toMatchObject({ googleMeet: true, location: 'https://meet.google.com/abc-defg-hi1' });
    expect(google.createMeet).toHaveBeenCalledWith(7, expect.objectContaining({ summary: 'გასაუბრება: Ani Ts · Graphic Designer', durationMin: 45 }));
    expect(email.queueEmail.mock.calls[0][2]).toContain('https://meet.google.com/abc-defg-hi1');

    const later = inDays(3);
    const moved = await service.update(hr, 1, { startsAt: later, location: 'ignored' });
    expect(moved.location).toBe('https://meet.google.com/abc-defg-hi1');
    expect(google.updateEvent).toHaveBeenCalledWith(7, 'ev1', expect.objectContaining({ startsAt: new Date(later) }));

    await service.update(hr, 1, { cancel: true });
    expect(google.deleteEvent).toHaveBeenCalledWith(7, 'ev1');

    // The next interview gets a meeting of its own
    const next = await service.schedule(hr, 3, { ...draft, googleMeet: true });
    expect(next.interview.location).toBe('https://meet.google.com/abc-defg-hi2');
  });

  it('Google Meet: if Google fails nothing is saved; a later failed card move removes the event too; on site drops it', async () => {
    const { service, interviews, pipeline, google, email, draft } = setup();
    google.createMeet.mockRejectedValueOnce(new BadRequestException('Google ანგარიში ხელახლა დააკავშირეთ'));
    await expect(service.schedule(hr, 3, { ...draft, googleMeet: true })).rejects.toThrow('ხელახლა');
    expect(interviews.rows).toHaveLength(0);
    expect(email.queueEmail).not.toHaveBeenCalled();

    pipeline.update.mockRejectedValueOnce(new Error('db down'));
    await expect(service.schedule(hr, 3, { ...draft, googleMeet: true })).rejects.toThrow('db down');
    expect(google.deleteEvent).toHaveBeenCalledWith(7, 'ev1');
    expect(interviews.rows).toHaveLength(0);

    // Without googleMeet nothing touches Google; switching on site later drops a generated link
    await service.schedule(hr, 3, { ...draft, googleMeet: true });
    const onsite = await service.update(hr, interviews.rows[0].id, { format: InterviewFormat.ONSITE, location: 'Tbilisi, Rustaveli 1' });
    expect(onsite).toMatchObject({ googleMeet: false, location: 'Tbilisi, Rustaveli 1' });
    expect(google.deleteEvent).toHaveBeenLastCalledWith(7, 'ev2');
  });

  it('a reminder for an old time (rescheduled since) is ignored', async () => {
    const { service, email, draft, token, interviews } = setup();
    await service.schedule(hr, 3, draft);
    await service.answer(token(), { action: 'confirm' });
    email.queueEmail.mockClear();

    await service.sendReminder({ interviewId: 1, startsAt: new Date(draft.startsAt).getTime() - HOUR, hours: 24 });
    expect(email.queueEmail).not.toHaveBeenCalled();

    await service.sendReminder({ interviewId: 1, startsAt: interviews.rows[0].startsAt.getTime(), hours: 24 });
    expect(email.queueEmail.mock.calls.map((c) => c[0])).toEqual(['ani@example.test', 'hr@acme.ge']);
  });
});
