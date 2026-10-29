import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum LogoStatus {
  /** No logo found at any source yet */
  NONE = 'NONE',
  /** A logo URL is waiting to be downloaded */
  PENDING = 'PENDING',
  OK = 'OK',
  FAILED = 'FAILED',
}

/**
 * A company that posts vacancies, identified by its normalized name (companyKey) across sources.
 * Holds the one logo its vacancies share: downloaded once, resized and served from the public R2 bucket.
 */
@Entity('companies')
export class CompanyEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  key: string;

  // First spelling seen; for logs and a future admin page
  @Column({ type: 'varchar', length: 255 })
  name: string;

  // Public URL of the 128px version; the 256px one has the same name with -256
  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  logoUrl: string | null;

  @Column({ type: 'enum', enum: LogoStatus, default: LogoStatus.NONE })
  logoStatus: LogoStatus;

  // Where the logo comes (or will come) from
  @Column({ type: 'text', nullable: true, default: null })
  logoSourceUrl: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true, default: null })
  logoSource: string | null;

  // Higher wins when several sources have a logo for the company
  @Column({ type: 'smallint', default: 0 })
  logoQuality: number;

  @Column({ type: 'timestamptz', nullable: true, default: null })
  logoCheckedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
