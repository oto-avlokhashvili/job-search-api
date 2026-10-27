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
 * One card on an HR's boards: an unlocked candidate in one vacancy (or in none), with its stage,
 * rating and tags. A CV has at most one entry without a vacancy and one per vacancy.
 * Unlocking creates the no-vacancy entry; adding to a vacancy moves it there.
 */
@Entity('hr_pipeline_entries')
@Index(['hrUserId', 'cvId'], { unique: true, where: '"vacancyId" IS NULL' })
@Index(['vacancyId', 'cvId'], { unique: true, where: '"vacancyId" IS NOT NULL' })
export class HrPipelineEntry {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  hrUserId: number;

  @Column()
  cvId: number;

  // Null: unlocked but not in any vacancy yet (shown on the main board only).
  @Column({ type: 'int', nullable: true, default: null })
  vacancyId: number | null;

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
