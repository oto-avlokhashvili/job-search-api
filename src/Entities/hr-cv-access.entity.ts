import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum HrCvAccessAction {
  UNLOCK = 'UNLOCK', // HR opened the candidate's contact details
  DOWNLOAD = 'DOWNLOAD', // HR downloaded the CV file
  INVITED = 'INVITED', // The candidate joined through the HR's interview invitation (no quota)
  ADDED = 'ADDED', // The HR added the candidate by hand (no quota)
}

/** Access types that open a candidate's contacts and file to the HR. */
export const CONTACT_ACCESS = [HrCvAccessAction.UNLOCK, HrCvAccessAction.INVITED, HrCvAccessAction.ADDED];

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
