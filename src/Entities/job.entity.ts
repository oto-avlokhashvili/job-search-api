import { Column, Entity, Index, OneToMany, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { SentJob } from './sent-jobs.entity';

@Entity()
@Unique(['link'])
@Unique(['fingerprint'])
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
  @Column({ nullable: true })
  fingerprint: string;
  @Column()
  publishDate:string;
  @Column()
  deadline:string;
  @Column()
  page:number;
  @Column({ nullable: true })
  description?: string;

  // companyKey(company): links the vacancy to its row in `companies`
  @Index()
  @Column({ type: 'varchar', length: 255, nullable: true, default: null })
  companyKey?: string | null;

  // The company's logo (public 128px URL), copied here so every vacancy query returns it
  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  companyLogo?: string | null;
}
