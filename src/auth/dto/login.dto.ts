import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsString, MinLength } from "class-validator";

export class LoginDto {
  @ApiProperty({ example: 'string', description: 'User email' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'string', description: 'User password' })
  @IsString()
  @MinLength(6)
  password: string;
}