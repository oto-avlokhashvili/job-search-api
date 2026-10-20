import { IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(10)
  page?: number = 1;
}
