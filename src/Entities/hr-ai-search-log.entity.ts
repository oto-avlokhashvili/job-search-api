import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One AI candidate search: the request, the terms it was expanded into and the CVs it ranked.
 * Joined with hr_cv_access (what the HR then unlocked) it shows whether the search finds the right
 * people, and when the keyword prefilter should give way to embeddings.
 */
@Entity('hr_ai_search_logs')
@Index(['hrUserId', 'createdAt'])
export class HrAiSearchLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  hrUserId: number;

  @Column({ type: 'varchar', length: 500 })
  query: string;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  keywords: string[];

  // CVs the keyword prefilter found, before the AI ranked them
  @Column({ type: 'int', default: 0 })
  poolSize: number;

  // LinkedIn profiles found alongside (0 when that half was skipped or failed)
  @Column({ type: 'int', default: 0 })
  linkedinCount: number;

  // Ranked CV ids, best first (LinkedIn results aren't kept)
  @Column({ type: 'int', array: true, default: () => "'{}'" })
  resultCvIds: number[];

  // False when the AI was unavailable and the deterministic score ordered the results
  @Column({ type: 'boolean', default: true })
  aiRanked: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
