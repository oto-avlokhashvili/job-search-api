import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum InterviewFormat {
  ONLINE = 'ONLINE',
  ONSITE = 'ONSITE',
}

export enum InterviewStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  DECLINED = 'DECLINED',
  RESCHEDULE_REQUESTED = 'RESCHEDULE_REQUESTED',
  CANCELLED = 'CANCELLED',
}

/**
 * An interview an HR scheduled for one board card. The candidate answers through a link
 * (no account needed): confirm, decline, or ask for another time.
 * An invitation to someone not on the platform yet has no card until they accept with their CV.
 */
@Entity('hr_interviews')
@Index(['hrUserId', 'startsAt'])
@Index(['entryId'])
export class HrInterview {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  hrUserId: number;

  // The board card (CV + vacancy) this interview is for; null while an invitee hasn't joined
  @Column({ type: 'int', nullable: true, default: null })
  entryId: number | null;

  @Column({ type: 'int', nullable: true, default: null })
  cvId: number | null;

  // Invitation to a new candidate: who it was sent to, until their own CV takes over
  @Column({ type: 'varchar', length: 150, nullable: true, default: null })
  inviteeName: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true, default: null })
  inviteeEmail: string | null;

  // Invitation link: one person can join through it until then (the HR can issue a new one)
  @Column({ type: 'timestamptz', nullable: true, default: null })
  inviteExpiresAt: Date | null;

  // The position the interview is for, as the HR set it on an invitation (else the vacancy's title)
  @Column({ type: 'varchar', length: 150, nullable: true, default: null })
  position: string | null;

  @Column({ type: 'int', nullable: true, default: null })
  vacancyId: number | null;

  @Column({ type: 'timestamptz' })
  startsAt: Date;

  @Column({ type: 'smallint', default: 45 })
  durationMin: number;

  @Column({ type: 'enum', enum: InterviewFormat, default: InterviewFormat.ONLINE })
  format: InterviewFormat;

  // Meeting link (online) or address (on site)
  @Column({ type: 'varchar', length: 500, default: '' })
  location: string;

  // The HR's Google Calendar event holding the generated Meet link (then `location` is that link)
  @Column({ type: 'varchar', length: 255, nullable: true, default: null })
  googleEventId: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true, default: null })
  message: string | null;

  // Other times the HR offers; the candidate can confirm one of them straight from the email
  @Column({ type: 'timestamptz', array: true, default: () => "'{}'" })
  alternatives: Date[];

  @Column({ type: 'enum', enum: InterviewStatus, default: InterviewStatus.PENDING })
  status: InterviewStatus;

  // Candidate's decline reason or reschedule note
  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  candidateNote: string | null;

  // Times the candidate suggested instead
  @Column({ type: 'timestamptz', array: true, default: () => "'{}'" })
  proposedTimes: Date[];

  // Part of the candidate's link signature; the link itself is never stored
  @Column({ type: 'varchar', length: 32 })
  linkNonce: string;

  // Where the invitation went; null when the HR saved it without sending
  @Column({ type: 'varchar', length: 255, nullable: true, default: null })
  sentTo: string | null;

  @Column({ type: 'timestamptz', nullable: true, default: null })
  respondedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
