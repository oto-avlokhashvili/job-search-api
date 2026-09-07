// src/Entities/cv.entity.ts
import { CvSummaryDetails } from "src/cv/dto/cv-summary.dto";
import { PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Entity } from "typeorm";

@Entity('cv_files')
export class Cv {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: number;

  @Column()
  fileName: string;

  @Column()
  originalName: string;

  @Column()
  mimeType: string;

  @Column()
  size: number;

  @Column({ type: 'bytea' })
  fileData: Buffer;

  @Column({ type: 'jsonb', nullable: true, default: null })
  summary: CvSummaryDetails | null;

  // Column default of true backfills existing rows as consented when this field is added to the table.
  @Column({ type: 'boolean', default: true })
  consentGiven: boolean;

  @Column({ type: 'timestamp', nullable: true, default: null })
  consentGivenAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}