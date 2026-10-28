import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
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

  @ApiPropertyOptional({ default: true, description: 'Email the candidate about the change' })
  @IsOptional()
  @IsBoolean()
  notify?: boolean;
}

export class InterviewAnswerDto {
  @ApiProperty({ enum: ['confirm', 'decline', 'reschedule'] })
  @IsIn(['confirm', 'decline', 'reschedule'])
  action: 'confirm' | 'decline' | 'reschedule';

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

  @ApiPropertyOptional({ type: [String], maxItems: MAX_ALTERNATIVES })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ALTERNATIVES)
  @IsDateString({}, { each: true })
  proposedTimes?: string[];
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
