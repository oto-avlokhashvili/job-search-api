import { IsNumber, IsOptional, IsString, Min, IsArray } from "class-validator";
import { Type } from "class-transformer";

export class FilterJobDto {

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  query?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 10;
}