import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class ContactEmailDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'The email address of the user sending the feedback/message',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    example: 'Hello, I have a question about the subscription plans.',
    description: 'The message or feedback content',
  })
  @IsString()
  @IsNotEmpty()
  comment: string;
}
