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