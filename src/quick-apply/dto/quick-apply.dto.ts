import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

const trim = ({ value }) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value);

/**
 * Multipart form. Signed in: everything but consent is optional (the stored CV and account are used;
 * a file replaces the stored CV). Without an account: email and file are required too. Name and phone
 * are read from the CV when left out (see POST /quick-apply/preview).
 */
export class QuickApplyDto {
  @ApiProperty({
    description: 'Consent to store the CV, send it to this employer and show it to HRs searching for candidates. Must be true.',
  })
  @Transform(({ value }) => value === 'true' || value === true || value === 1 || value === '1')
  @IsBoolean()
  consent: boolean;

  @ApiPropertyOptional({ maxLength: 150, description: 'Without an account; read from the CV when left out' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(150)
  fullName?: string;

  @ApiPropertyOptional({ description: 'Required without an account; the employer replies here' })
  @IsOptional()
  @Transform(trim)
  @IsEmail({}, { message: 'ელ-ფოსტა არასწორია' })
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  phoneNumber?: string;

  @ApiPropertyOptional({ description: 'Cloudflare Turnstile token, without an account (when TURNSTILE_SECRET_KEY is set)' })
  @IsOptional()
  @IsString()
  turnstileToken?: string;
}
