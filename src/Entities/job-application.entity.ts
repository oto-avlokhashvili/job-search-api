import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum JobApplicationStatus {
  QUEUED = 'QUEUED', // Waiting to be emailed
  SENT = 'SENT', // The email provider accepted it
  FAILED = 'FAILED', // Gave up after the retries
}

/**
 * A quick apply: a candidate's CV emailed to the address a scraped vacancy asks for, from our own
 * mailbox with the candidate as reply-to. Also the record of which CV went where, under their consent.
 * jobId and cvId are plain columns, not foreign keys: outdated jobs are deleted, and the user's
 * history keeps the vacancy's title, company and link from the moment they applied.
 */
@Entity('job_applications')
// One application per vacancy per candidate (a double click or a retry never emails the employer twice)
@Index(['jobId', 'candidateEmail'], { unique: true })
@Index(['userId'])
export class JobApplication {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  jobId: number;

  @Column({ type: 'varchar', length: 500 })
  jobTitle: string;

  @Column({ type: 'varchar', length: 255 })
  company: string;

  @Column({ type: 'varchar', length: 1000 })
  jobLink: string;

  @Column()
  cvId: number;

  // Null for a candidate without an account
  @Column({ type: 'int', nullable: true, default: null })
  userId: number | null;

  // The employer's address the CV is sent to
  @Column({ type: 'varchar', length: 255 })
  toEmail: string;

  // Lowercased; the employer's replies go here
  @Column({ type: 'varchar', length: 255 })
  candidateEmail: string;

  @Column({ type: 'varchar', length: 150 })
  candidateName: string;

  @Column({ type: 'varchar', length: 50, nullable: true, default: null })
  candidatePhone: string | null;

  @Column({ type: 'enum', enum: JobApplicationStatus, default: JobApplicationStatus.QUEUED })
  status: JobApplicationStatus;

  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  error: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamp', nullable: true, default: null })
  sentAt: Date | null;
}
