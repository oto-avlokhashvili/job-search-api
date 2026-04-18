import {
  IsString,
  IsNumber,
  IsBoolean,
  IsArray,
  IsOptional,
  IsUrl,
  Min,
  Max,
  IsInt,
  IsPositive,
} from 'class-validator';

export class CreateAiMatchedJobDto {
  @IsString()
  vacancy: string;

  @IsInt()
  @IsPositive()
  id: number;

  @IsString()
  location: string;

  @IsString()
  company: string;

  @IsUrl()
  link: string;

  @IsString()
  publishDate: string;

  @IsString()
  deadline: string;

  @IsNumber()
  page: number;

  @IsBoolean()
  archived: boolean;

  @IsOptional()
  @IsString()
  salaryRange?: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  match: number;

  @IsBoolean()
  queryMatch: boolean;

  @IsOptional()
  @IsString()
  matchReason?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  matchGaps?: string[];
}