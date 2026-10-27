import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from 'src/Entities/user.entity';
import { HrCvAccess, HrCvAccessAction } from 'src/Entities/hr-cv-access.entity';
import { HrPipelineEntry, PipelineStage } from 'src/Entities/hr-pipeline-entry.entity';
import { HrPipelineEvent, PipelineEventType } from 'src/Entities/hr-pipeline-event.entity';
import { HrCandidateNote } from 'src/Entities/hr-candidate-note.entity';
import { UpdatePipelineDto } from './dto/hr-pipeline.dto';
import { applyPipelineChange, DEFAULT_PIPELINE_STATE } from './pipeline';

export interface PipelineView {
  stage: PipelineStage;
  rejectionReason: string | null;
  rating: number | null;
  tags: string[];
  position: number | null;
}

export interface ActivityItem {
  id: string;
  kind: 'NOTE' | PipelineEventType;
  createdAt: Date;
  author: { id: number; name: string };
  noteId?: number;
  body?: string;
  fromStage?: PipelineStage | null;
  toStage?: PipelineStage | null;
  rejectionReason?: string | null;
  rating?: number | null;
}

const toView = (entry?: HrPipelineEntry | null): PipelineView =>
  entry
    ? {
        stage: entry.stage,
        rejectionReason: entry.rejectionReason,
        rating: entry.rating,
        tags: entry.tags ?? [],
        position: entry.position,
      }
    : { ...DEFAULT_PIPELINE_STATE, position: null };

/**
 * "My candidates" board: stage, order, rating, tags, notes and history of the CVs this HR unlocked.
 * Everything is per HR user and only for unlocked CVs. Nothing here touches the unlock quota.
 */
@Injectable()
export class HrPipelineService {
  constructor(
    @InjectRepository(HrPipelineEntry) private readonly entryRepository: Repository<HrPipelineEntry>,
    @InjectRepository(HrPipelineEvent) private readonly eventRepository: Repository<HrPipelineEvent>,
    @InjectRepository(HrCandidateNote) private readonly noteRepository: Repository<HrCandidateNote>,
    @InjectRepository(HrCvAccess) private readonly accessRepository: Repository<HrCvAccess>,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
  ) {}

  /** Board state for each card, keyed by CV id; candidates never moved get the default. */
  async attach<T extends { id: number }>(hrUserId: number, cards: T[]): Promise<(T & { pipeline: PipelineView })[]> {
    if (!cards.length) return [];
    const entries = await this.entryRepository.find({ where: { hrUserId, cvId: In(cards.map((c) => c.id)) } });
    const byCv = new Map(entries.map((e) => [e.cvId, e]));
    return cards.map((card) => ({ ...card, pipeline: toView(byCv.get(card.id)) }));
  }

  async update(hr: User, cvId: number, dto: UpdatePipelineDto): Promise<PipelineView> {
    await this.assertUnlocked(hr.id, cvId);

    const existing = await this.entryRepository.findOne({ where: { hrUserId: hr.id, cvId } });
    const { state, events } = applyPipelineChange(existing ?? DEFAULT_PIPELINE_STATE, dto);

    // Upsert: two quick moves of a never-moved card must not race into a duplicate row.
    await this.entryRepository.upsert({ hrUserId: hr.id, cvId, ...state }, ['hrUserId', 'cvId']);
    if (events.length) {
      await this.eventRepository.insert(events.map((e) => ({ ...e, hrUserId: hr.id, cvId })));
    }
    if (dto.order) await this.setOrder(hr.id, dto.order);

    return toView(await this.entryRepository.findOne({ where: { hrUserId: hr.id, cvId } }));
  }

  /** Notes and history of one candidate, newest first. */
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
          fromStage: e.fromStage,
          toStage: e.toStage,
          rejectionReason: e.rejectionReason,
          rating: e.rating,
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

  /** Positions for a column after a drop; ids this HR hasn't unlocked are skipped. */
  private async setOrder(hrUserId: number, cvIds: number[]) {
    const ids = Array.from(new Set(cvIds));
    const unlocked = await this.unlockedIds(hrUserId, ids);
    const rows = ids.filter((id) => unlocked.has(id)).map((cvId, position) => ({ hrUserId, cvId, position }));
    if (rows.length) await this.entryRepository.upsert(rows, ['hrUserId', 'cvId']);
  }

  private async assertUnlocked(hrUserId: number, cvId: number) {
    if (!(await this.unlockedIds(hrUserId, [cvId])).has(cvId)) {
      throw new ForbiddenException('Open the candidate\'s contacts first');
    }
  }

  private async unlockedIds(hrUserId: number, cvIds: number[]): Promise<Set<number>> {
    if (!cvIds.length) return new Set();
    const rows = await this.accessRepository.find({
      where: { hrUserId, cvId: In(cvIds), action: HrCvAccessAction.UNLOCK },
      select: ['cvId'],
    });
    return new Set(rows.map((r) => r.cvId));
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
