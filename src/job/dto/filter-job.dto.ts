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

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  publishDate?: string;

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