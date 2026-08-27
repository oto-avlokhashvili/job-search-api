import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { SubscriptionPlan, SubscriptionStatus } from 'src/enums/subscriptions.enum';

export class AssignPlanDto {
  @ApiProperty({ enum: SubscriptionPlan, example: SubscriptionPlan.PRO })
  @IsEnum(SubscriptionPlan)
  plan: SubscriptionPlan;

  @ApiPropertyOptional({ example: 30, description: 'Duration in days' })
  @IsOptional()
  @IsInt()
  @Min(1)
  durationDays?: number = 30;

  @ApiPropertyOptional({ enum: SubscriptionStatus, example: SubscriptionStatus.ACTIVE })
  @IsOptional()
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus = SubscriptionStatus.ACTIVE;

  @ApiPropertyOptional({ example: 'cus_123456' })
  @IsOptional()
  @IsString()
  providerCustomerId?: string;

  @ApiPropertyOptional({ example: 'sub_123456' })
  @IsOptional()
  @IsString()
  providerSubscriptionId?: string;
}

export class CancelSubscriptionDto {
  @ApiPropertyOptional({
    example: false,
    description: 'If true, cancels immediately. If false, cancels at the end of the current billing period.',
  })
  @IsOptional()
  cancelImmediately?: boolean = false;
}
