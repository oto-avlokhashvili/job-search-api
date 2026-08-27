import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { SubscriptionService } from './subscription.service';
import { EntitlementService } from './entitlement.service';
import { AssignPlanDto, CancelSubscriptionDto } from './dto/update-subscription.dto';

@ApiTags('Subscription')
@Controller('subscription')
export class SubscriptionController {
  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly entitlementService: EntitlementService,
  ) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearerAuth')
  @ApiOperation({ summary: 'Get current user subscription details and effective capabilities' })
  async getMySubscription(@Req() req) {
    const user = req.user;
    const subscription = await this.subscriptionService.getSubscription(user.id);
    const effectivePlan = this.entitlementService.getEffectivePlan(user);
    const features = this.entitlementService.getFeaturesForUser(user);

    return {
      effectivePlan,
      subscriptionDetails: subscription,
      features,
    };
  }

  @Patch('assign/:userId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearerAuth')
  @ApiOperation({ summary: 'Assign or update a subscription plan for a user' })
  async assignPlan(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: AssignPlanDto,
  ) {
    return this.subscriptionService.assignPlan(userId, dto);
  }

  @Post('cancel')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearerAuth')
  @ApiOperation({ summary: 'Cancel current user subscription' })
  async cancelMySubscription(
    @Req() req,
    @Body() dto: CancelSubscriptionDto,
  ) {
    return this.subscriptionService.cancelSubscription(req.user.id, dto.cancelImmediately);
  }
}
