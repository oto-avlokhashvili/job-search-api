import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { SeniorityLevel } from 'src/cv/dto/cv-summary.dto';
import { LEVEL_ORDER } from 'src/cv/public-cv-search.service';

export class HrCandidateSearchDto {
  // Same convention as the LinkedIn search: comma-separated values are OR-ed
  @ApiProperty({ example: 'Angular,React', description: 'Role or skills. Comma-separated values are OR-ed' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  keyword: string;

  @ApiPropertyOptional({ example: 'Tbilisi' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  location?: string;

  @ApiPropertyOptional({ enum: LEVEL_ORDER, description: 'CVs 2+ levels away are excluded' })
  @IsOptional()
  @IsIn(LEVEL_ORDER)
  seniority?: SeniorityLevel;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}
