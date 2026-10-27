import { Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum PipelineStage {
  SOURCED = 'SOURCED',
  CONTACTED = 'CONTACTED',
  INTERVIEW = 'INTERVIEW',
  OFFER = 'OFFER',
  HIRED = 'HIRED',
  REJECTED = 'REJECTED',
}

/**
 * Where an unlocked candidate sits on this HR's "My candidates" board, plus rating and tags.
 * Created lazily: a candidate without a row is SOURCED with no rating/tags.
 */
@Entity('hr_pipeline_entries')
@Index(['hrUserId', 'cvId'], { unique: true })
export class HrPipelineEntry {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  hrUserId: number;

  @Column()
  cvId: number;

  @Column({ type: 'enum', enum: PipelineStage, default: PipelineStage.SOURCED })
  stage: PipelineStage;

  // Only kept while the stage is REJECTED.
  @Column({ type: 'varchar', length: 300, nullable: true, default: null })
  rejectionReason: string | null;

  // Order inside the stage's column, set by drag-and-drop. Null (never ordered) sorts first.
  @Column({ type: 'int', nullable: true, default: null })
  position: number | null;

  @Column({ type: 'smallint', nullable: true, default: null })
  rating: number | null;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  tags: string[];

  @UpdateDateColumn()
  updatedAt: Date;
}
