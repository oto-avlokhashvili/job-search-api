import { IsNumber, IsOptional, IsString, Min, Max, IsArray } from "class-validator";
import { Type } from "class-transformer";

export class FilterJobDto {

  @IsOptional()
  @IsString()
  query?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  publishDate?: string;

  // 'true' or '1': only vacancies that state a salary amount
  @IsOptional()
  @IsString()
  salary?: string;

  // Title category key (see job-category.ts): it, sales, finance, customer-service, ...
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  // Per page; a whole search never shows more than MAX_SEARCH_RESULTS (see search-limits.ts)
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(30)
  limit?: number = 10;
}