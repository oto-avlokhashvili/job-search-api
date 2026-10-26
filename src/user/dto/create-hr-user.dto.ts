import { IsNotEmpty, IsString, MaxLength } from "class-validator";
import { CreateUserDto } from "./create-user.dto";

export class CreateHrUserDto extends CreateUserDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(150)
    companyName: string;
}
