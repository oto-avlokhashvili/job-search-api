import { Column, Entity, OneToMany, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { SentJob } from './sent-jobs.entity';

@Entity()
@Unique(['link'])
export class JobEntity {
  @PrimaryGeneratedColumn()
  id: number;
  @Column()
  vacancy:string;
  @Column({ nullable: true })
  location:string;
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
  @Column({ nullable: true })
  description?: string;
  @Column({ default: false })
  archived: boolean;
}
