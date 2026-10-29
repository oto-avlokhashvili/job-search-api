// src/Entities/cv.entity.ts
import { CvSummaryDetails } from "src/cv/dto/cv-summary.dto";
import { PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Entity, Index } from "typeorm";

@Entity('cv_files')
export class Cv {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', nullable: true })
  @Index()
  userId: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  @Index()
  email: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  fullName: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  phoneNumber: string | null;

  @Column()
  fileName: string;

  @Column()
  originalName: string;

  @Column()
  mimeType: string;

  @Column()
  size: number;

  @Column({ type: 'varchar', length: 500, default: '' })
  storagePath: string;

  @Column({ type: 'jsonb', nullable: true, default: null })
  summary: CvSummaryDetails | null;

  // SHA-256 of the file bytes: an identical re-upload reuses the stored summary instead of a new AI call.
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  @Index()
  fileHash: string | null;

  // SHA-256 of the anonymous CV-search token; the raw token is only ever held by the browser.
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  @Index()
  searchTokenHash: string | null;

  // Column default of true backfills existing rows as consented when this field is added to the table.
  @Column({ type: 'boolean', default: true })
  consentGiven: boolean;

  @Column({ type: 'timestamp', nullable: true, default: null })
  consentGivenAt: Date | null;

  // A record an HR added by hand (name and position, no file): only that HR's board shows it,
  // it never appears in the candidate search
  @Column({ type: 'int', nullable: true, default: null })
  @Index()
  addedByHrId: number | null;

  // Such a record's position as the HR typed it (there's no AI summary without a file)
  @Column({ type: 'varchar', length: 150, nullable: true, default: null })
  manualPosition: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}