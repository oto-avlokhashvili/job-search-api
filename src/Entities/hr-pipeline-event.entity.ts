import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { PipelineStage } from './hr-pipeline-entry.entity';

export enum PipelineEventType {
  STAGE_CHANGED = 'STAGE_CHANGED',
  RATING_CHANGED = 'RATING_CHANGED',
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

  @CreateDateColumn()
  createdAt: Date;
}
