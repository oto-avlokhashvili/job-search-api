import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
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

/** A candidate the HR adds by hand: a card with no CV file, only on this HR's boards. */
export class CreateManualCandidateDto {
  @ApiProperty({ maxLength: 70, example: 'ანი' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(70)
  firstName: string;

  @ApiProperty({ maxLength: 70, example: 'ციცქიშვილი' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(70)
  lastName: string;

  @ApiPropertyOptional({ maxLength: 150, example: 'Graphic Designer', description: "Required on the main board; with a vacancy it defaults to the vacancy's title" })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(150)
  position?: string;

  @ApiPropertyOptional({ description: "Vacancy board to add to (the card shows on the main board too); omit for the main board only" })
  @IsOptional()
  @IsInt()
  vacancyId?: number;
}
