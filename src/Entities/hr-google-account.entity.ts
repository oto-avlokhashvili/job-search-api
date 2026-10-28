import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * The Google account an HR connected for interviews: Google Meet links are created in its calendar.
 * One per HR; the refresh token is stored encrypted.
 */
@Entity('hr_google_accounts')
export class HrGoogleAccount {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column()
  hrUserId: number;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  // AES-256-GCM: "<iv>.<tag>.<ciphertext>", base64url
  @Column({ type: 'text' })
  refreshToken: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
