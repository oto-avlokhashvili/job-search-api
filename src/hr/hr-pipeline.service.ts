import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { User } from 'src/Entities/user.entity';
import { CONTACT_ACCESS, HrCvAccess } from 'src/Entities/hr-cv-access.entity';
import { HrPipelineEntry, PipelineStage } from 'src/Entities/hr-pipeline-entry.entity';
import { HrPipelineEvent, PipelineEventType } from 'src/Entities/hr-pipeline-event.entity';
import { HrCandidateNote } from 'src/Entities/hr-candidate-note.entity';
import { UpdatePipelineDto } from './dto/hr-pipeline.dto';
import { applyPipelineChange } from './pipeline';

export interface PipelineView {
  id: number;
  vacancyId: number | null;
  stage: PipelineStage;
  rejectionReason: string | null;
  rating: number | null;
  tags: string[];
  position: number | null;
}

/** Which of this HR's vacancies a CV is in, shown on search cards. */
export interface VacancyMembership {
  entryId: number;
  vacancyId: number;
  stage: PipelineStage;
}

/** Board filter: every entry, only one vacancy's, or only the ones not in any vacancy. */
export type BoardFilter = number | 'none' | undefined;

export interface ActivityItem {
  id: string;
  kind: 'NOTE' | PipelineEventType;
  createdAt: Date;
  author: { id: number; name: string };
  noteId?: number;
  body?: string;
  vacancyId?: number | null;
  fromStage?: PipelineStage | null;
  toStage?: PipelineStage | null;
  rejectionReason?: string | null;
  rating?: number | null;
  interviewAt?: Date | null;
  note?: string | null;
}

const MAX_BOARD_ENTRIES = 500;

export const toView = (entry: HrPipelineEntry): PipelineView => ({
  id: entry.id,
  vacancyId: entry.vacancyId,
  stage: entry.stage,
  rejectionReason: entry.rejectionReason,
  rating: entry.rating,
  tags: entry.tags ?? [],
  position: entry.position,
});

/**
 * "My candidates" boards: the entries (cards) of the CVs this HR unlocked, one per vacancy the CV is in,
 * or a single no-vacancy entry. Notes are per candidate and shared by all of its entries.
 * Everything is per HR user. Nothing here touches the unlock quota.
 */
@Injectable()
export class HrPipelineService implements OnModuleInit {
  private readonly logger = new Logger(HrPipelineService.name);

  constructor(
    @InjectRepository(HrPipelineEntry) private readonly entryRepository: Repository<HrPipelineEntry>,
    @InjectRepository(HrPipelineEvent) private readonly eventRepository: Repository<HrPipelineEvent>,
    @InjectRepository(HrCandidateNote) private readonly noteRepository: Repository<HrCandidateNote>,
    @InjectRepository(HrCvAccess) private readonly accessRepository: Repository<HrCvAccess>,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
  ) {}

  /**
   * Entries used to be created lazily, on the first move. Give every unlocked CV without one
   * its no-vacancy entry, so each card has an id. Safe to run on every boot.
   */
  async onModuleInit() {
    try {
      const result: { id: number }[] = await this.entryRepository.query(`
        INSERT INTO hr_pipeline_entries ("hrUserId", "cvId")
        SELECT DISTINCT a."hrUserId", a."cvId" FROM hr_cv_access a
        WHERE a.action = 'UNLOCK'
          AND NOT EXISTS (SELECT 1 FROM hr_pipeline_entries e WHERE e."hrUserId" = a."hrUserId" AND e."cvId" = a."cvId")
        ON CONFLICT DO NOTHING
        RETURNING id
      `);
      if (result.length) this.logger.log(`Created ${result.length} board entries for previously unlocked CVs`);
    } catch (error) {
      this.logger.error(`Board entry backfill failed: ${error.message}`);
    }
  }

  /** Called on unlock: the CV gets its no-vacancy card unless it's already on a board. */
  async ensureEntry(hrUserId: number, cvId: number): Promise<void> {
    if (await this.entryRepository.exists({ where: { hrUserId, cvId } })) return;
    await this.entryRepository.createQueryBuilder().insert().values({ hrUserId, cvId }).orIgnore().execute();
  }

  /** The CV's card on a vacancy's board (added if needed), or on the main board without a vacancy. */
  async placeCandidate(hrUserId: number, cvId: number, vacancyId: number | null): Promise<HrPipelineEntry> {
    if (vacancyId !== null) return this.addToVacancy(hrUserId, vacancyId, cvId);
    await this.ensureEntry(hrUserId, cvId);
    // Its no-vacancy card, or the card it already has on some vacancy board
    const entries = await this.entryRepository.find({ where: { hrUserId, cvId }, order: { id: 'ASC' } });
    return entries.find((e) => e.vacancyId === null) ?? entries[0];
  }

  /** Entries for a board, newest first; the client orders each column by position. */
  board(hrUserId: number, filter: BoardFilter): Promise<HrPipelineEntry[]> {
    const vacancyId = filter === 'none' ? IsNull() : filter;
    return this.entryRepository.find({
      where: { hrUserId, ...(vacancyId !== undefined && { vacancyId }) },
      order: { id: 'DESC' },
      take: MAX_BOARD_ENTRIES,
    });
  }

  async memberships(hrUserId: number, cvIds: number[]): Promise<Map<number, VacancyMembership[]>> {
    const map = new Map<number, VacancyMembership[]>();
    if (!cvIds.length) return map;
    const entries = await this.entryRepository.find({
      where: { hrUserId, cvId: In(cvIds), vacancyId: Not(IsNull()) },
      order: { id: 'ASC' },
    });
    for (const e of entries) {
      const list = map.get(e.cvId) ?? [];
      list.push({ entryId: e.id, vacancyId: e.vacancyId!, stage: e.stage });
      map.set(e.cvId, list);
    }
    return map;
  }

  /** Candidate count per stage for each vacancy (key null = not in any vacancy). */
  async counts(hrUserId: number): Promise<{ vacancyId: number | null; stage: PipelineStage; count: number }[]> {
    const rows: { vacancyId: number | null; stage: PipelineStage; count: string }[] = await this.entryRepository
      .createQueryBuilder('e')
      .select('e.vacancyId', 'vacancyId')
      .addSelect('e.stage', 'stage')
      .addSelect('COUNT(*)', 'count')
      .where('e.hrUserId = :hrUserId', { hrUserId })
      .groupBy('e.vacancyId')
      .addGroupBy('e.stage')
      .getRawMany();
    return rows.map((r) => ({ vacancyId: r.vacancyId === null ? null : Number(r.vacancyId), stage: r.stage, count: Number(r.count) }));
  }

  /**
   * Puts an unlocked CV into a vacancy. A no-vacancy card moves there with its stage, rating and tags;
   * otherwise a new card starts as SOURCED. Already in the vacancy: returns that card.
   */
  async addToVacancy(hrUserId: number, vacancyId: number, cvId: number): Promise<HrPipelineEntry> {
    const existing = await this.entryRepository.findOne({ where: { vacancyId, cvId } });
    if (existing) return existing;

    const unassigned = await this.entryRepository.findOne({ where: { hrUserId, cvId, vacancyId: IsNull() } });
    if (unassigned) {
      await this.entryRepository.update(unassigned.id, { vacancyId, position: null });
    } else {
      // orIgnore: a double click must not fail on the unique index
      await this.entryRepository.createQueryBuilder().insert().values({ hrUserId, cvId, vacancyId }).orIgnore().execute();
    }
    return this.entryRepository.findOneOrFail({ where: { vacancyId, cvId } });
  }

  /**
   * Takes a card off its vacancy's board. The unlock stays: a CV with no other card goes back
   * to "no vacancy" (keeping its stage); otherwise the card is deleted. Returns the kept card, if any.
   */
  async removeFromVacancy(hr: User, entryId: number): Promise<PipelineView | null> {
    const entry = await this.findOwned(hr.id, entryId);
    if (entry.vacancyId === null) throw new BadRequestException('The candidate is not in a vacancy');
    const kept = await this.detach(entry);
    return kept && toView(kept);
  }

  /** Before a vacancy is deleted: every card leaves it the same way as removeFromVacancy. */
  async detachVacancy(hrUserId: number, vacancyId: number): Promise<void> {
    const entries = await this.entryRepository.find({ where: { hrUserId, vacancyId } });
    for (const entry of entries) await this.detach(entry);
  }

  async update(hr: User, entryId: number, dto: UpdatePipelineDto): Promise<PipelineView> {
    const entry = await this.findOwned(hr.id, entryId);
    const { stage, rejectionReason, rating, tags } = entry;
    const { state, events } = applyPipelineChange({ stage, rejectionReason, rating, tags }, dto);

    await this.entryRepository.update(entry.id, state);
    if (events.length) {
      await this.eventRepository.insert(
        events.map((e) => ({ ...e, hrUserId: hr.id, cvId: entry.cvId, vacancyId: entry.vacancyId })),
      );
    }
    if (dto.order) await this.setOrder(hr.id, dto.order);

    return toView(await this.entryRepository.findOneByOrFail({ id: entry.id }));
  }

  /** Notes and history of one candidate across all of its cards, newest first. */
  async activity(hr: User, cvId: number): Promise<ActivityItem[]> {
    await this.assertUnlocked(hr.id, cvId);

    const [notes, events] = await Promise.all([
      this.noteRepository.find({ where: { authorId: hr.id, cvId }, order: { createdAt: 'DESC' }, take: 200 }),
      this.eventRepository.find({ where: { hrUserId: hr.id, cvId }, order: { createdAt: 'DESC' }, take: 200 }),
    ]);
    const authors = await this.authorNames([...notes.map((n) => n.authorId), ...events.map((e) => e.hrUserId)]);

    return [
      ...notes.map((n) => this.noteItem(n, authors)),
      ...events.map(
        (e): ActivityItem => ({
          id: `event-${e.id}`,
          kind: e.type,
          createdAt: e.createdAt,
          author: { id: e.hrUserId, name: authors.get(e.hrUserId) ?? '' },
          vacancyId: e.vacancyId,
          fromStage: e.fromStage,
          toStage: e.toStage,
          rejectionReason: e.rejectionReason,
          rating: e.rating,
          interviewAt: e.interviewAt,
          note: e.note,
        }),
      ),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async addNote(hr: User, cvId: number, body: string): Promise<ActivityItem> {
    await this.assertUnlocked(hr.id, cvId);
    const text = body.trim();
    if (!text) throw new BadRequestException('Note is empty');

    const note = await this.noteRepository.save(this.noteRepository.create({ cvId, authorId: hr.id, body: text }));
    return this.noteItem(note, await this.authorNames([hr.id]));
  }

  async deleteNote(hr: User, noteId: number): Promise<void> {
    const note = await this.noteRepository.findOne({ where: { id: noteId } });
    if (!note) throw new NotFoundException('Note not found');
    if (note.authorId !== hr.id) throw new ForbiddenException('Only the author can delete this note');
    await this.noteRepository.delete(noteId);
  }

  private async detach(entry: HrPipelineEntry): Promise<HrPipelineEntry | null> {
    const others = await this.entryRepository.count({
      where: { hrUserId: entry.hrUserId, cvId: entry.cvId, id: Not(entry.id) },
    });
    if (others) {
      await this.entryRepository.delete(entry.id);
      return null;
    }
    await this.entryRepository.update(entry.id, { vacancyId: null, position: null });
    return { ...entry, vacancyId: null, position: null };
  }

  /** History entry for a card, e.g. an interview update (written by the interview service). */
  async recordEvent(entry: HrPipelineEntry, event: Partial<HrPipelineEvent> & { type: PipelineEventType }) {
    await this.eventRepository.insert({ ...event, hrUserId: entry.hrUserId, cvId: entry.cvId, vacancyId: entry.vacancyId });
  }

  async findOwned(hrUserId: number, entryId: number): Promise<HrPipelineEntry> {
    const entry = await this.entryRepository.findOne({ where: { id: entryId, hrUserId } });
    if (!entry) throw new NotFoundException('Candidate is not on your board');
    return entry;
  }

  /** Positions for a column after a drop (entry ids, top to bottom); other HRs' entries are skipped. */
  private async setOrder(hrUserId: number, entryIds: number[]) {
    const ids = Array.from(new Set(entryIds));
    if (!ids.length) return;
    await this.entryRepository.query(
      'UPDATE hr_pipeline_entries SET position = array_position($2::int[], id) - 1 WHERE "hrUserId" = $1 AND id = ANY($2::int[])',
      [hrUserId, ids],
    );
  }

  private async assertUnlocked(hrUserId: number, cvId: number) {
    const unlocked = await this.accessRepository.exists({ where: { hrUserId, cvId, action: In(CONTACT_ACCESS) } });
    if (!unlocked) throw new ForbiddenException('Open the candidate\'s contacts first');
  }

  private async authorNames(ids: number[]): Promise<Map<number, string>> {
    const unique = Array.from(new Set(ids));
    if (!unique.length) return new Map();
    const users = await this.userRepository.find({ where: { id: In(unique) }, select: ['id', 'firstName', 'lastName'] });
    return new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
  }

  private noteItem(note: HrCandidateNote, authors: Map<number, string>): ActivityItem {
    return {
      id: `note-${note.id}`,
      kind: 'NOTE',
      createdAt: note.createdAt,
      author: { id: note.authorId, name: authors.get(note.authorId) ?? '' },
      noteId: note.id,
      body: note.body,
    };
  }
}
