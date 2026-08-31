import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('waitlist')
export class Waitlist {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  @Index()
  email: string;

  @Column({ type: 'int', nullable: true })
  userId: number | null;

  @Column({
    type: 'varchar',
    length: 50,
    default: 'PRO',
  })
  plan: string;

  @Column({ type: 'varchar', length: 100, nullable: true, default: 'landing' })
  source: string;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
