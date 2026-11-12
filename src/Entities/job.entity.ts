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

  // The pay the vacancy states, as the site shows it ("1 500 ლარი", "50 ლარი/დღე"); '' = none stated
  // ("შეთანხმებით"); null = not worked out yet (JobService fills those in). See extractJobSalary.
  // The "salary shown" filter and the salary label both read this, so they always agree.
  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  salary?: string | null;

  // Title categories for the category filter, stored as ",it,sales," (LIKE '%,it,%' finds one);
  // '' = none fits; null = not worked out yet (JobService fills those in). See categorizeJob.
  @Column({ type: 'varchar', length: 255, nullable: true, default: null })
  categories?: string | null;

  // Where the vacancy asks for CVs, for quick apply (see extractApplyEmail); '' = no address in the
  // description (apply on the source site); null = not worked out yet (JobService fills those in).
  @Column({ type: 'varchar', length: 255, nullable: true, default: null })
  applyEmail?: string | null;

  // The company's logo (public 128px URL), copied here so every vacancy query returns it
  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  companyLogo?: string | null;
}
