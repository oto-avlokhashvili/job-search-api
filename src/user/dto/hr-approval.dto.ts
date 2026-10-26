import { IsBoolean } from "class-validator";

export class HrApprovalDto {
    @IsBoolean()
    approved: boolean;
}
