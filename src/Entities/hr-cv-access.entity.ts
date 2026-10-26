import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum HrCvAccessAction {
  UNLOCK = 'UNLOCK', // HR opened the candidate's contact details
  DOWNLOAD = 'DOWNLOAD', // HR downloaded the CV file
}

/**
 * Audit log of HR access to candidate personal data. An UNLOCK row also grants that HR
 * lasting access to the CV's contacts and file.
 * cvId is a plain column, not a foreign key, so the log outlives deleted CVs.
 */
@Entity('hr_cv_access')
@Index(['hrUserId', 'cvId'])
export class HrCvAccess {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  hrUserId: number;

  @Column()
  @Index()
  cvId: number;

  @Column({ type: 'enum', enum: HrCvAccessAction })
  action: HrCvAccessAction;

  @CreateDateColumn()
  createdAt: Date;
}
