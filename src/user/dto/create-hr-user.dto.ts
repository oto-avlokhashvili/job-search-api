import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { CreateUserDto } from "./create-user.dto";
import { HrType } from "src/enums/hr-type.enum";

export class CreateHrUserDto extends CreateUserDto {
    @ApiPropertyOptional({ enum: HrType, default: HrType.COMPANY, description: 'Company HR, or an outsource recruiter (agency / freelance)' })
    @IsOptional()
    @IsEnum(HrType)
    hrType?: HrType = HrType.COMPANY;

    // Required for a company HR; an outsource recruiter may name their agency or leave it empty
    @ApiPropertyOptional({ description: "The company (company HR) or the agency's name (outsource, optional)" })
    @ValidateIf((dto: CreateHrUserDto) => dto.hrType !== HrType.OUTSOURCE || !!dto.companyName)
    @IsString()
    @IsNotEmpty()
    @MaxLength(150)
    companyName?: string;
}
