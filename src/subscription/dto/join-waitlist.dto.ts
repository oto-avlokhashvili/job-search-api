import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class JoinWaitlistDto {
  @ApiPropertyOptional({
    description: 'Email address of the user (required if not authenticated)',
    example: 'user@example.com',
  })
  @IsEmail({}, { message: 'გთხოვთ მიუთითოთ ვალიდური ელ-ფოსტა' })
  @IsOptional()
  email?: string;

  @ApiProperty({
    description: 'Subscription plan of interest (PRO, ENTERPRISE, etc.)',
    example: 'PRO',
    default: 'PRO',
  })
  @IsString()
  @IsNotEmpty({ message: 'გეგმის დასახელება აუცილებელია' })
  plan: string;

  @ApiPropertyOptional({
    description: 'Source component where user joined the waitlist',
    example: 'landing',
  })
  @IsString()
  @IsOptional()
  source?: string;

  @ApiPropertyOptional({
    description: 'Additional notes or requirements (e.g. company name, phone)',
    example: 'Company hiring 5 developers',
  })
  @IsString()
  @IsOptional()
  notes?: string;
}
