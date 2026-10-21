import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class PublicCvReconnectDto {
  @ApiProperty({ description: 'Email the CV was submitted with', example: 'candidate@example.com' })
  @IsNotEmpty({ message: 'Email is required' })
  @IsEmail({}, { message: 'Invalid email address format' })
  email: string;

  @ApiProperty({ description: 'Original file name of the uploaded CV, as saved by the browser', example: 'cv.pdf' })
  @IsNotEmpty({ message: 'File name is required' })
  @IsString()
  @MaxLength(255)
  fileName: string;
}
