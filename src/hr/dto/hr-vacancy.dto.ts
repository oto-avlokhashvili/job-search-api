import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { HrVacancyStatus } from 'src/Entities/hr-vacancy.entity';

const trim = ({ value }) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value);

export class CreateVacancyDto {
  @ApiProperty({ maxLength: 120, example: 'Accountant' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title: string;
}

export class UpdateVacancyDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional({ enum: HrVacancyStatus })
  @IsOptional()
  @IsEnum(HrVacancyStatus)
  status?: HrVacancyStatus;
}

export class BoardQueryDto {
  @ApiPropertyOptional({ description: 'A vacancy id, or "none" for candidates not in any vacancy. Omit for all.' })
  @IsOptional()
  @Matches(/^(none|\d+)$/)
  vacancyId?: string;
}
