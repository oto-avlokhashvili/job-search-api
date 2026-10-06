import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Raw scraper output waiting to be merged into the job table.
 * Rows are scoped by runId and deleted once the run has been merged.
 */
@Entity()
@Index(['runId', 'source'])
export class ScrapedJobEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  runId: string;

  @Column()
  source: string;

  @Column()
  vacancy: string;

  @Column({ nullable: true })
  location: string;

  @Column()
  company: string;

  @Column({ type: 'text' })
  link: string;

  @Column()
  publishDate: string;

  @Column()
  deadline: string;

  @Column()
  page: number;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
