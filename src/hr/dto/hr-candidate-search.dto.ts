import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { toBool } from 'src/linkedin-search/dto/linkedin-search.dto';
import { EXPERIENCE_FILTERS } from '../candidate-score';
import type { ExperienceFilter } from '../candidate-score';

export class HrCandidateSearchDto {
  // Same convention as the LinkedIn search: comma-separated values are OR-ed.
  // Optional: a search with filters only lists the matching CVs, newest first, without a match score.
  @ApiPropertyOptional({ example: 'Angular,React', description: 'Role or skills. Comma-separated values are OR-ed. Optional when a filter is set' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  keyword?: string;

  @ApiPropertyOptional({ example: 'Tbilisi' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  location?: string;

  // No company filter here: the CV base is searched by role and skills (the AI search and LinkedIn have it)

  @ApiPropertyOptional({ example: 'Free University of Tbilisi', description: 'University studied at. Comma-separated values are OR-ed' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  university?: string;

  @ApiPropertyOptional({ example: 'React,TypeScript', description: 'Skills the candidate must all have. Comma-separated values are AND-ed' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  skills?: string;

  @ApiPropertyOptional({ example: 'English,Russian', description: 'Languages the candidate must all speak. Comma-separated values are AND-ed' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  languages?: string;

  @ApiPropertyOptional({
    enum: EXPERIENCE_FILTERS,
    description: 'CVs 2+ levels away are excluded. Entry: Junior CVs with under a year of work (no experience)',
  })
  @IsOptional()
  @IsIn(EXPERIENCE_FILTERS)
  seniority?: ExperienceFilter;

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

export class HrAiCandidateSearchDto {
  @ApiProperty({
    example: 'Senior React developer with fintech experience, Tbilisi or remote',
    description: 'The candidate you want, in plain language (Georgian or English)',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  query: string;

  @ApiPropertyOptional({ example: 'TBC Bank', description: 'Current or past employer: filters our CVs and the LinkedIn half. Comma-separated values are OR-ed' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  company?: string;

  @ApiPropertyOptional({ example: 'Free University of Tbilisi', description: 'University studied at. Comma-separated values are OR-ed' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  university?: string;

  @ApiPropertyOptional({ example: 'React,TypeScript', description: 'Skills the candidate must all have. Comma-separated values are AND-ed' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  skills?: string;

  @ApiPropertyOptional({ example: 'English,Russian', description: 'Languages the candidate must all speak. Comma-separated values are AND-ed' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  languages?: string;

  @ApiPropertyOptional({ default: false, description: 'LinkedIn half: only profiles that say they are open to work' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  openToWork?: boolean = false;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 10, maximum: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  limit?: number = 10;
}
