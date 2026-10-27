import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { User } from 'src/Entities/user.entity';
import { HrPipelineEntry, PipelineStage } from 'src/Entities/hr-pipeline-entry.entity';
import { PipelineEventType } from 'src/Entities/hr-pipeline-event.entity';
import { HrPipelineService } from './hr-pipeline.service';

const hr = { id: 7, firstName: 'Nino', lastName: 'B' } as User;

const entry = (over: Partial<HrPipelineEntry> = {}): HrPipelineEntry => ({
  id: 1,
  hrUserId: 7,
  cvId: 10,
  vacancyId: null,
  stage: PipelineStage.SOURCED,
  rejectionReason: null,
  position: null,
  rating: null,
  tags: [],
  updatedAt: new Date(),
  ...over,
});

function setup({ unlocked = [10], rows = [entry()] }: { unlocked?: number[]; rows?: HrPipelineEntry[] } = {}) {
  // Tiny in-memory stand-in: findOne/count match on the plain fields of `where`
  const matches = (e: HrPipelineEntry, where: Record<string, any>) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && '_type' in v) {
        if (v._type === 'isNull') return e[k] === null;
        if (v._type === 'not') return e[k] !== v._value;
        return true;
      }
      return e[k] === v;
    });
  const insertExecute = jest.fn();
  const entries = {
    rows,
    findOne: jest.fn(({ where }) => Promise.resolve(rows.find((e) => matches(e, where)) ?? null)),
    findOneOrFail: jest.fn(({ where }) => Promise.resolve(rows.find((e) => matches(e, where)))),
    findOneByOrFail: jest.fn(({ id }) => Promise.resolve(rows.find((e) => e.id === id))),
    exists: jest.fn(({ where }) => Promise.resolve(rows.some((e) => matches(e, where)))),
    count: jest.fn(({ where }) => Promise.resolve(rows.filter((e) => matches(e, where)).length)),
    find: jest.fn().mockResolvedValue([]),
    update: jest.fn((id, values) => {
      Object.assign(rows.find((e) => e.id === id)!, values);
      return Promise.resolve();
    }),
    delete: jest.fn(),
    query: jest.fn(),
    createQueryBuilder: jest.fn(() => {
      const qb: any = {};
      qb.insert = () => qb;
      qb.values = jest.fn((v) => {
        insertExecute.mockImplementation(() => rows.push(entry({ id: 100 + rows.length, ...v })));
        return qb;
      });
      qb.orIgnore = () => qb;
      qb.execute = insertExecute;
      return qb;
    }),
  };
  const events = { find: jest.fn().mockResolvedValue([]), insert: jest.fn() };
  const notes = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    create: jest.fn((n) => n),
    save: jest.fn((n) => ({ id: 1, createdAt: new Date(), ...n })),
    delete: jest.fn(),
  };
  const access = { exists: jest.fn(({ where }) => Promise.resolve(unlocked.includes(where.cvId))) };
  const users = { find: jest.fn().mockResolvedValue([hr]) };
  const service = new HrPipelineService(entries as any, events as any, notes as any, access as any, users as any);
  return { service, entries, events, notes, insertExecute };
}

describe('HrPipelineService', () => {
  it("refuses changes to another HR's card and notes on a CV not unlocked", async () => {
    const { service, entries } = setup({ unlocked: [], rows: [entry({ hrUserId: 8 })] });
    await expect(service.update(hr, 1, { stage: PipelineStage.INTERVIEW })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.addNote(hr, 10, 'hi')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.activity(hr, 10)).rejects.toBeInstanceOf(ForbiddenException);
    expect(entries.update).not.toHaveBeenCalled();
  });

  it('saves the move and records it with the card vacancy', async () => {
    const { service, entries, events } = setup({ rows: [entry({ vacancyId: 3 })] });
    const view = await service.update(hr, 1, { stage: PipelineStage.CONTACTED });
    expect(entries.update).toHaveBeenCalledWith(1, expect.objectContaining({ stage: PipelineStage.CONTACTED }));
    // Only pipeline fields are written, never the id or owner
    expect(Object.keys(entries.update.mock.calls[0][1]).sort()).toEqual(['rating', 'rejectionReason', 'stage', 'tags']);
    expect(events.insert).toHaveBeenCalledWith([
      expect.objectContaining({ type: PipelineEventType.STAGE_CHANGED, toStage: PipelineStage.CONTACTED, cvId: 10, vacancyId: 3 }),
    ]);
    expect(view).toMatchObject({ id: 1, vacancyId: 3, stage: PipelineStage.CONTACTED });
  });

  it("orders the column by entry id, limited to this HR's entries", async () => {
    const { service, entries } = setup();
    await service.update(hr, 1, { order: [3, 1, 3, 2] });
    expect(entries.query).toHaveBeenCalledWith(expect.stringContaining('array_position'), [7, [3, 1, 2]]);
  });

  it('moves the no-vacancy card into the vacancy, keeping its stage', async () => {
    const { service, entries, insertExecute } = setup({ rows: [entry({ stage: PipelineStage.INTERVIEW, position: 2 })] });
    const result = await service.addToVacancy(7, 5, 10);
    expect(insertExecute).not.toHaveBeenCalled();
    expect(entries.rows).toHaveLength(1);
    expect(result).toMatchObject({ id: 1, vacancyId: 5, stage: PipelineStage.INTERVIEW, position: null });
  });

  it('adds a second card when the CV is already in another vacancy, and is idempotent', async () => {
    const { service, entries, insertExecute } = setup({ rows: [entry({ vacancyId: 4 })] });
    const added = await service.addToVacancy(7, 5, 10);
    expect(insertExecute).toHaveBeenCalledTimes(1);
    expect(added).toMatchObject({ vacancyId: 5, cvId: 10, stage: PipelineStage.SOURCED });

    await service.addToVacancy(7, 5, 10);
    expect(insertExecute).toHaveBeenCalledTimes(1);
    expect(entries.rows).toHaveLength(2);
  });

  it('removing from a vacancy keeps the last card without a vacancy, deletes extra ones', async () => {
    const only = setup({ rows: [entry({ vacancyId: 5, stage: PipelineStage.OFFER })] });
    expect(await only.service.removeFromVacancy(hr, 1)).toMatchObject({ id: 1, vacancyId: null, stage: PipelineStage.OFFER });
    expect(only.entries.delete).not.toHaveBeenCalled();

    const two = setup({ rows: [entry({ vacancyId: 5 }), entry({ id: 2, vacancyId: 6 })] });
    expect(await two.service.removeFromVacancy(hr, 1)).toBeNull();
    expect(two.entries.delete).toHaveBeenCalledWith(1);

    await expect(only.service.removeFromVacancy(hr, 1)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates the no-vacancy card on unlock only when the CV has no card yet', async () => {
    const fresh = setup({ rows: [] });
    await fresh.service.ensureEntry(7, 10);
    expect(fresh.insertExecute).toHaveBeenCalledTimes(1);

    const onBoard = setup({ rows: [entry({ vacancyId: 5 })] });
    await onBoard.service.ensureEntry(7, 10);
    expect(onBoard.insertExecute).not.toHaveBeenCalled();
  });

  it('lists notes and history together, newest first', async () => {
    const { service, notes, events } = setup();
    const t = (m: number) => new Date(2026, 9, 27, 10, m);
    notes.find.mockResolvedValue([{ id: 1, cvId: 10, authorId: 7, body: 'called', createdAt: t(5) }]);
    events.find.mockResolvedValue([
      { id: 2, hrUserId: 7, cvId: 10, vacancyId: 5, type: PipelineEventType.STAGE_CHANGED, toStage: PipelineStage.CONTACTED, createdAt: t(9) },
      { id: 3, hrUserId: 7, cvId: 10, vacancyId: null, type: PipelineEventType.RATING_CHANGED, rating: 4, createdAt: t(1) },
    ]);

    const items = await service.activity(hr, 10);
    expect(items.map((i) => i.id)).toEqual(['event-2', 'note-1', 'event-3']);
    expect(items[0]).toMatchObject({ vacancyId: 5 });
    expect(items[1]).toMatchObject({ kind: 'NOTE', body: 'called', author: { id: 7, name: 'Nino B' } });
  });

  it('trims notes and rejects empty ones', async () => {
    const { service, notes } = setup();
    await service.addNote(hr, 10, '  first call done  ');
    expect(notes.create).toHaveBeenCalledWith({ cvId: 10, authorId: 7, body: 'first call done' });
    await expect(service.addNote(hr, 10, '   ')).rejects.toThrow('Note is empty');
  });

  it('lets only the author delete a note', async () => {
    const { service, notes } = setup();
    notes.findOne.mockResolvedValueOnce({ id: 5, authorId: 8 });
    await expect(service.deleteNote(hr, 5)).rejects.toBeInstanceOf(ForbiddenException);

    notes.findOne.mockResolvedValueOnce(null);
    await expect(service.deleteNote(hr, 5)).rejects.toBeInstanceOf(NotFoundException);

    notes.findOne.mockResolvedValueOnce({ id: 5, authorId: 7 });
    await service.deleteNote(hr, 5);
    expect(notes.delete).toHaveBeenCalledWith(5);
  });
});
