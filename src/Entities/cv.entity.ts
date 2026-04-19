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

  @Column()
  storagePath: string;

  @Column()
  publicUrl: string;

  @Column({ type: 'jsonb', nullable: true, default: null })
  summary: CvSummaryDetails | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
