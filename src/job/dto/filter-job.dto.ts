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
  company?: string;

  // Exact company (normalized name, see companyKey()); `company` above is a substring match
  @IsOptional()
  @IsString()
  companyKey?: string;

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

  // Capped so a single request can't download the whole table; the sitemap uses
  // the internal /job/sitemap endpoint instead.
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(50)
  limit?: number = 10;
}