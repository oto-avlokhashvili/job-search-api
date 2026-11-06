import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Query-string booleans arrive as text; only an explicit true counts (default false).
 * Reads the raw value: the global implicit conversion turns any non-empty string, "false" too, into true.
 */
export const toBool = ({ obj, key }: { obj: Record<string, unknown>; key: string }) => {
  const raw = obj[key];
  return raw === true || raw === 'true' || raw === '1' || raw === 1;
};

export class LinkedinSearchDto {
  // Comma-separated keywords are OR-ed together: "Angular,React" -> ("Angular" OR "React")
  @ApiProperty({ example: 'Angular', description: 'Required. Comma-separated values are OR-ed' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  keyword: string;

  @ApiPropertyOptional({ example: 'Tbilisi' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  location?: string;

  @ApiPropertyOptional({ example: 'TBC Bank,Bank of Georgia', description: 'Current or past employer. Comma-separated values are OR-ed' })
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

  @ApiPropertyOptional({ default: false, description: 'Only profiles that say they are open to work' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  openToWork?: boolean = false;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(10)
  page?: number = 1;
}
