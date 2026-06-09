import { IsInt, IsNumber, IsOptional, IsPositive, IsString } from "class-validator";

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
    @IsOptional()
    location?: string | null;

    @IsString()
    company: string;

    @IsNumber()
    match: number;

    @IsString()
    @IsOptional()
    salaryRange?: string | null;
}
