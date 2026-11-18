import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * What people search for, to choose which searches become keyword pages ("ვაკანსიები თბილისში").
 * Only the normalized text and how often it was searched: never who searched.
 */
@Entity('search_queries')
export class SearchQueryEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 200 })
  query: string;

  @Column({ type: 'int', default: 1 })
  count: number;

  /** Vacancies the last search for it found (0 = a gap worth knowing about) */
  @Column({ type: 'int', default: 0 })
  lastResults: number;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  lastSearchedAt: Date;
}
