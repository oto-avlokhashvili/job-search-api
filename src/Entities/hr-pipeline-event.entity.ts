import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { PipelineStage } from './hr-pipeline-entry.entity';

export enum PipelineEventType {
  STAGE_CHANGED = 'STAGE_CHANGED',
  RATING_CHANGED = 'RATING_CHANGED',
  // Interview invitation and the candidate's answers
  INTERVIEW_SCHEDULED = 'INTERVIEW_SCHEDULED',
  INTERVIEW_UPDATED = 'INTERVIEW_UPDATED',
  INTERVIEW_CONFIRMED = 'INTERVIEW_CONFIRMED',
  INTERVIEW_DECLINED = 'INTERVIEW_DECLINED',
  INTERVIEW_RESCHEDULE_REQUESTED = 'INTERVIEW_RESCHEDULE_REQUESTED',
  INTERVIEW_CANCELLED = 'INTERVIEW_CANCELLED',
}

/** Candidate history on the board; shown together with notes in the activity timeline. */
@Entity('hr_pipeline_events')
@Index(['hrUserId', 'cvId'])
export class HrPipelineEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  hrUserId: number;

  @Column()
  cvId: number;

  // The vacancy whose board the change happened on; null for the no-vacancy card.
  @Column({ type: 'int', nullable: true, default: null })
  vacancyId: number | null;

  @Column({ type: 'enum', enum: PipelineEventType })
  type: PipelineEventType;

  @Column({ type: 'enum', enum: PipelineStage, nullable: true, default: null })
  fromStage: PipelineStage | null;

  @Column({ type: 'enum', enum: PipelineStage, nullable: true, default: null })
  toStage: PipelineStage | null;

  @Column({ type: 'varchar', length: 300, nullable: true, default: null })
  rejectionReason: string | null;

  @Column({ type: 'smallint', nullable: true, default: null })
  rating: number | null;

  // Interview events: the interview time at that moment, and the candidate's note
  @Column({ type: 'timestamptz', nullable: true, default: null })
  interviewAt: Date | null;

  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  note: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
