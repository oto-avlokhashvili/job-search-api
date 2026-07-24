import { IsBoolean, IsEmail, IsOptional, IsString } from "class-validator";

export class CreateUserDto {
    @IsString()
    firstName: string;

    @IsString()
    lastName:string;

    @IsString()
    @IsEmail()
    email: string;

    @IsString()
    password:string;

    @IsOptional()
    @IsBoolean()
    receiveMessages?: boolean;
}
