import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { SentJob } from './sent-jobs.entity';

@Entity()
export class JobEntity {
  @PrimaryGeneratedColumn()
  id: number;
  @Column()
  vacancy:string;
  @Column()
  company:string;
  @Column()
  link:string;
  @Column()
  publishDate:string;
  @Column()
  deadline:string;
  @Column()
  page:number;
  
  @OneToMany(() => SentJob, sentJob => sentJob.job)
  sentJobs: SentJob[];
}
