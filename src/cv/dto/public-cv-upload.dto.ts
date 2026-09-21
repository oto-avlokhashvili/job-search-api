import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class PublicCvUploadDto {
  @ApiProperty({ description: 'Candidate email address for HRs/recruiters to contact', example: 'candidate@example.com' })
  @IsNotEmpty({ message: 'Email is required' })
  @IsEmail({}, { message: 'Invalid email address format' })
  email: string;

  @ApiPropertyOptional({ description: 'Full name of candidate', example: 'John Doe' })
  @IsOptional()
  @IsString()
  fullName?: string;

  @ApiPropertyOptional({ description: 'Phone number of candidate', example: '+995599123456' })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @ApiProperty({ description: 'Consent to store CV and allow recruiters to contact you', example: true })
  @Transform(({ value }) => value === 'true' || value === true || value === 1 || value === '1')
  @IsBoolean({ message: 'Consent must be a boolean' })
  consent: boolean;
}
