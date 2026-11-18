import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** A visitor followed a search result to its original posting. No visitor data is kept. */
@Entity('job_clicks')
export class JobClickEntity {
  @PrimaryGeneratedColumn()
  id: number;

  // No foreign key: clicks outlive the vacancies they were for
  @Index()
  @Column()
  jobId: number;

  /** The site the visitor was sent to (hr.ge, jobs.ge, linkedin.com, ...) */
  @Column({ type: 'varchar', length: 100 })
  host: string;

  @Index()
  @CreateDateColumn()
  createdAt: Date;
}
