import { IsInt, IsPositive } from "class-validator";

export class CreateSentJobDto {
    @IsInt()
    @IsPositive()
    userId: number;

    @IsInt()
    @IsPositive()
    jobId: number;
}
