import { IsString, IsNotEmpty, MinLength, IsUrl, IsDateString, IsNumber } from "class-validator";

export class JobDto {
    @IsNumber()
    @IsNotEmpty()
    id: number;

    @IsNotEmpty()
    @MinLength(3)
    vacancy: string;

    @IsString()
    @IsNotEmpty()
    location: string;

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

    @IsString()
    salaryRange?: string;

    @IsNumber()
    match: number;
}