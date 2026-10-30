import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { InterviewFormat } from 'src/Entities/hr-interview.entity';
import { MAX_ALTERNATIVES } from '../interview';

export class ScheduleInterviewDto {
  @ApiProperty({ example: '2026-10-30T10:00:00.000Z' })
  @IsDateString()
  startsAt: string;

  @ApiPropertyOptional({ minimum: 15, maximum: 240, default: 45 })
  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(240)
  durationMin?: number;

  @ApiProperty({ enum: InterviewFormat })
  @IsEnum(InterviewFormat)
  format: InterviewFormat;

  @ApiPropertyOptional({ description: 'Meeting link (online) or address (on site)', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  location?: string;

  @ApiPropertyOptional({ description: "Online: create a Google Meet link in the HR's connected calendar (replaces location)" })
  @IsOptional()
  @IsBoolean()
  googleMeet?: boolean;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;

  @ApiPropertyOptional({ type: [String], description: 'Other times the candidate can pick from the email', maxItems: MAX_ALTERNATIVES })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ALTERNATIVES)
  @IsDateString({}, { each: true })
  alternatives?: string[];

  @ApiPropertyOptional({ default: true, description: 'Email the invitation to the candidate' })
  @IsOptional()
  @IsBoolean()
  send?: boolean;
}

export class UpdateInterviewDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @ApiPropertyOptional({ minimum: 15, maximum: 240 })
  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(240)
  durationMin?: number;

  @ApiPropertyOptional({ enum: InterviewFormat })
  @IsOptional()
  @IsEnum(InterviewFormat)
  format?: InterviewFormat;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  location?: string;

  @ApiPropertyOptional({ description: 'true: create a Google Meet link if there is none; false: drop the generated one' })
  @IsOptional()
  @IsBoolean()
  googleMeet?: boolean;

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string | null;

  @ApiPropertyOptional({ type: [String], maxItems: MAX_ALTERNATIVES })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ALTERNATIVES)
  @IsDateString({}, { each: true })
  alternatives?: string[];

  @ApiPropertyOptional({ description: "Accept one of the candidate's proposed times (index)" })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_ALTERNATIVES - 1)
  acceptProposed?: number;

  @ApiPropertyOptional({ description: 'Cancel the interview' })
  @IsOptional()
  @IsBoolean()
  cancel?: boolean;

  @ApiPropertyOptional({ description: 'Invitation nobody joined yet: a new link, valid for another day (the old one stops working)' })
  @IsOptional()
  @IsBoolean()
  renewLink?: boolean;

  @ApiPropertyOptional({ default: true, description: 'Email the candidate about the change' })
  @IsOptional()
  @IsBoolean()
  notify?: boolean;
}

export class InterviewAnswerDto {
  @ApiProperty({ enum: ['confirm', 'reschedule', 'decline'] })
  @IsIn(['confirm', 'reschedule', 'decline'])
  action: 'confirm' | 'reschedule' | 'decline';

  @ApiPropertyOptional({ maxLength: 150, description: "reschedule, invitee not on the platform yet: their name (new times are emailed)" })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  fullName?: string;

  @ApiPropertyOptional({ description: 'reschedule, invitee not on the platform yet: where the new times go' })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional({ description: "confirm: one of the HR's alternative times (index)" })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_ALTERNATIVES - 1)
  slot?: number;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ description: 'decline: none of the offered times suits the candidate' })
  @IsOptional()
  @IsBoolean()
  timeConflict?: boolean;
}

export class GoogleConnectDto {
  @ApiProperty({ description: 'The code Google added to the callback URL' })
  @IsString()
  @MaxLength(2000)
  code: string;

  @ApiProperty({ description: 'The state Google added to the callback URL' })
  @IsString()
  @MaxLength(500)
  state: string;
}

/**
 * Interview invitation as a link (valid for a day, for one person): whoever opens it gives their details
 * and CV when accepting. The HR shares the link themselves; nothing is emailed (`send` is ignored).
 */
export class InviteInterviewDto extends ScheduleInterviewDto {
  @ApiPropertyOptional({ description: 'Vacancy board the candidate joins; omit for the main board only' })
  @IsOptional()
  @IsInt()
  vacancyId?: number;

  @ApiPropertyOptional({ maxLength: 150, description: "Required without a vacancy; with one it defaults to the vacancy's title" })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  position?: string;

  @ApiPropertyOptional({ maxLength: 150, description: 'Who the link is for, when the HR knows (e.g. a LinkedIn profile): names the row and prefills their form' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  inviteeName?: string;
}

const toBool = ({ value }: { value: unknown }) => value === true || value === 'true' || value === '1' || value === 1;

/** An invited candidate's acceptance with their details and CV (multipart/form-data, the CV in `file`). */
export class InterviewJoinDto {
  @ApiProperty({ enum: ['confirm'] })
  @IsIn(['confirm'])
  action: 'confirm';

  @ApiPropertyOptional({ description: "One of the HR's alternative times (index)" })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_ALTERNATIVES - 1)
  slot?: number;

  @ApiProperty({ maxLength: 150 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  fullName: string;

  @ApiProperty()
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiProperty({ maxLength: 50 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  phoneNumber: string;

  @ApiProperty({ description: 'Consent to store the CV and share it with the inviting HR' })
  @Transform(toBool)
  @IsBoolean()
  consent: boolean;
}
