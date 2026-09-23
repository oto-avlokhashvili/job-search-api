import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsUrl,
  IsNumber,
  IsDateString,
  MinLength,
  Min,
  IsOptional
} from 'class-validator';
export class CreateJobDto {
  @ApiProperty({ description: 'Vacancy title', example: 'Senior Backend Developer (Node.js)', minLength: 3 })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  vacancy: string;

  @ApiProperty({ description: 'Job location (city)', example: 'თბილისი' })
  @IsString()
  @IsNotEmpty()
  location: string;

  @ApiProperty({ description: 'Company name', example: 'Aldagi', minLength: 2 })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  company: string;

  @ApiProperty({ description: 'Unique link to the original vacancy', example: 'https://jobs.ge/ge/?view=jobs&id=123456' })
  @IsUrl()
  @IsNotEmpty()
  link: string;

  @ApiProperty({ description: 'Publish date (ISO 8601)', example: '2026-09-23' })
  @IsDateString()
  @IsNotEmpty()
  publishDate: string;

  @ApiProperty({ description: 'Application deadline (ISO 8601)', example: '2026-10-23' })
  @IsDateString()
  @IsNotEmpty()
  deadline: string;

  @ApiPropertyOptional({ description: 'Source page number (defaults to 1)', example: 1, minimum: 1 })
  @IsNumber()
  @Min(1)
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ description: 'Deduplication fingerprint; generated from vacancy|company|location when omitted' })
  @IsString()
  @IsOptional()
  fingerprint?: string;

  @ApiPropertyOptional({
    description: 'Full vacancy description',
    example: 'We are looking for a backend developer with 4+ years of experience in Node.js, NestJS and PostgreSQL.',
  })
  @IsString()
  @IsOptional()
  description?: string;
}
