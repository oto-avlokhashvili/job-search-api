import { IsInt, IsNumber, IsPositive, IsString } from "class-validator";

export class CreateSentJobDto {
    @IsInt()
    @IsPositive()
    userId: number;

    @IsInt()
    @IsPositive()
    jobId: number;
    
    @IsString()
    vacancy: string;

    @IsString()
    location: string;

    @IsString()
    company: string;

    @IsNumber()
    match: number;

    @IsString()
    salaryRange: string;
}
