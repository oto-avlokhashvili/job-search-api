import { 
  IsString, 
  IsNotEmpty, 
  IsUrl, 
  IsNumber, 
  IsDateString,
  MinLength,
  Min
} from 'class-validator';
export class CreateJobDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  vacancy: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  company: string;

  @IsUrl()
  @IsNotEmpty()
  link: string;

  @IsDateString()
  @IsNotEmpty()
  publishDate: string;
  @IsDateString()
  @IsNotEmpty()
  deadline: string;

  @IsNumber()
  @Min(1)
  page?: number;
}
