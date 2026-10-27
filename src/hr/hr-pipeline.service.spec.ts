import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { User } from 'src/Entities/user.entity';
import { PipelineStage } from 'src/Entities/hr-pipeline-entry.entity';
import { PipelineEventType } from 'src/Entities/hr-pipeline-event.entity';
import { HrPipelineService } from './hr-pipeline.service';

const hr = { id: 7, firstName: 'Nino', lastName: 'B' } as User;

function setup({ unlocked = [10] }: { unlocked?: number[] } = {}) {
  const entries = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn().mockResolvedValue(null), upsert: jest.fn() };
  const events = { find: jest.fn().mockResolvedValue([]), insert: jest.fn() };
  const notes = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    create: jest.fn((n) => n),
    save: jest.fn((n) => ({ id: 1, createdAt: new Date(), ...n })),
    delete: jest.fn(),
  };
  const access = {
    // Only the CVs in `unlocked` come back as unlocked by this HR
    find: jest.fn(({ where }) => {
      const ids: number[] = where.cvId._value ?? where.cvId.value ?? [];
      return Promise.resolve(ids.filter((id) => unlocked.includes(id)).map((cvId) => ({ cvId })));
    }),
  };
  const users = { find: jest.fn().mockResolvedValue([hr]) };
  const service = new HrPipelineService(entries as any, events as any, notes as any, access as any, users as any);
  return { service, entries, events, notes };
}

describe('HrPipelineService', () => {
  it('refuses board changes for a candidate this HR has not unlocked', async () => {
    const { service, entries } = setup({ unlocked: [] });
    await expect(service.update(hr, 10, { stage: PipelineStage.INTERVIEW })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.addNote(hr, 10, 'hi')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.activity(hr, 10)).rejects.toBeInstanceOf(ForbiddenException);
    expect(entries.upsert).not.toHaveBeenCalled();
  });

  it('saves the move and records the stage change', async () => {
    const { service, entries, events } = setup();
    await service.update(hr, 10, { stage: PipelineStage.CONTACTED });
    expect(entries.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ hrUserId: 7, cvId: 10, stage: PipelineStage.CONTACTED }),
      ['hrUserId', 'cvId'],
    );
    expect(events.insert).toHaveBeenCalledWith([
      expect.objectContaining({ type: PipelineEventType.STAGE_CHANGED, toStage: PipelineStage.CONTACTED, hrUserId: 7, cvId: 10 }),
    ]);
  });

  it('orders the column, skipping CVs this HR has not unlocked', async () => {
    const { service, entries } = setup({ unlocked: [10, 11, 12] });
    await service.update(hr, 10, { stage: PipelineStage.OFFER, order: [12, 99, 10, 11] });
    expect(entries.upsert).toHaveBeenLastCalledWith(
      [
        { hrUserId: 7, cvId: 12, position: 0 },
        { hrUserId: 7, cvId: 10, position: 1 },
        { hrUserId: 7, cvId: 11, position: 2 },
      ],
      ['hrUserId', 'cvId'],
    );
  });

  it('gives never-moved candidates the default board state', async () => {
    const { service } = setup();
    const [card] = await service.attach(7, [{ id: 10 }]);
    expect(card.pipeline).toEqual({ stage: PipelineStage.SOURCED, rejectionReason: null, rating: null, tags: [], position: null });
  });

  it('lists notes and history together, newest first', async () => {
    const { service, notes } = setup();
    const t = (m: number) => new Date(2026, 9, 27, 10, m);
    notes.find.mockResolvedValue([{ id: 1, cvId: 10, authorId: 7, body: 'called', createdAt: t(5) }]);
    (service as any).eventRepository.find.mockResolvedValue([
      { id: 2, hrUserId: 7, cvId: 10, type: PipelineEventType.STAGE_CHANGED, toStage: PipelineStage.CONTACTED, createdAt: t(9) },
      { id: 3, hrUserId: 7, cvId: 10, type: PipelineEventType.RATING_CHANGED, rating: 4, createdAt: t(1) },
    ]);

    const items = await service.activity(hr, 10);
    expect(items.map((i) => i.id)).toEqual(['event-2', 'note-1', 'event-3']);
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
