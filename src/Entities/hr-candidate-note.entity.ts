import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** HR's note on an unlocked candidate. Visible to its author only, like the rest of the board. */
@Entity('hr_candidate_notes')
@Index(['authorId', 'cvId'])
export class HrCandidateNote {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  cvId: number;

  @Column()
  authorId: number;

  @Column({ type: 'varchar', length: 2000 })
  body: string;

  @CreateDateColumn()
  createdAt: Date;
}
