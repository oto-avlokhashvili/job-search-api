import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum HrVacancyStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

/**
 * An HR's own hiring position, used to group candidates into separate boards.
 * Private to its HR; not a published job ad.
 */
@Entity('hr_vacancies')
@Index(['hrUserId'])
export class HrVacancy {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  hrUserId: number;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'enum', enum: HrVacancyStatus, default: HrVacancyStatus.OPEN })
  status: HrVacancyStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
