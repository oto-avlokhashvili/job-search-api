import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';


@Entity('top_jobs')
export class AiMatchedJob {
  @PrimaryGeneratedColumn()
  matchId: number;

  @Column({ name: 'id'})
  id: number;
  
  @Column({ type: 'int', name: 'user_id' })
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar' })
  vacancy: string;

  @Column({ type: 'varchar' })
  location: string;

  @Column({ type: 'varchar' })
  company: string;

  @Column({ type: 'varchar' })
  link: string; 

  @Column({ type: 'varchar', name: 'publish_date' })
  publishDate: string;

  @Column({ type: 'varchar' })
  deadline: string;

  @Column({ type: 'int' })
  page: number;

  @Column({ type: 'boolean', default: false })
  archived: boolean;

  @Column({ type: 'varchar', name: 'salary_range', nullable: true })
  salaryRange: string;

  @Column({ type: 'float', default: 0 })
  match: number;

  @Column({ type: 'boolean', name: 'query_match', default: false })
  queryMatch: boolean;

  @Column({ type: 'text', name: 'match_reason', nullable: true })
  matchReason: string;

  @Column({ type: 'simple-array', name: 'match_gaps', nullable: true })
  matchGaps: string[];
  
}