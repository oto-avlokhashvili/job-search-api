import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SendEmailDto {
  @ApiProperty({
    example: 'recipient@example.com',
    description: 'The email address of the recipient',
  })
  @IsEmail()
  @IsNotEmpty()
  to: string;

  @ApiProperty({
    example: 'Welcome to Job Search!',
    description: 'The subject line of the email',
  })
  @IsString()
  @IsNotEmpty()
  subject: string;

  @ApiProperty({
    example: '<h3>Hello!</h3><p>This is a test email sent via Brevo.</p>',
    description: 'The HTML body content of the email',
  })
  @IsString()
  @IsNotEmpty()
  html: string;

  @ApiProperty({
    example: 'sender@example.com',
    description: 'Optional sender email (must be a verified sender/domain in Brevo)',
    required: false,
  })
  @IsEmail()
  @IsOptional()
  senderEmail?: string;

  @ApiProperty({
    example: 'My Verified Brand',
    description: 'Optional sender name',
    required: false,
  })
  @IsString()
  @IsOptional()
  senderName?: string;
}
