import { ApiProperty, PartialType } from '@nestjs/swagger';
import { CreateCvDto } from './create-cv.dto';
import type { CvSummaryDetails, SeniorityLevel } from './cv-summary.dto';

export class UpdateCvDto extends PartialType(CreateCvDto) {}

export class UpdateCvSummaryDto implements CvSummaryDetails {
    
  @ApiProperty({ example: 'Backend Developer' })
  detectedRole: string;

  @ApiProperty({ enum: ['Junior', 'Mid', 'Senior', 'Lead', 'Principal'] })
  seniorityLevel: SeniorityLevel;

  @ApiProperty({ example: ['NestJS', 'TypeScript'], type: [String] })
  primarySkills: string[];

  @ApiProperty({ example: ['Docker', 'PostgreSQL'], type: [String] })
  secondarySkills: string[];

  @ApiProperty({ example: ['Fintech', 'E-commerce'], type: [String] })
  domains: string[];

  @ApiProperty({ example: 'Remote' })
  locationPreference: string;

  @ApiProperty({ example: 'Looking to grow into a Lead role' })
  careerDirection: string;
}
