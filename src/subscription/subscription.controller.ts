import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { Public } from 'src/auth/decorators/public.decorator';
import { SubscriptionService } from './subscription.service';
import { EntitlementService } from './entitlement.service';
import { AssignPlanDto, CancelSubscriptionDto } from './dto/update-subscription.dto';
import { JoinWaitlistDto } from './dto/join-waitlist.dto';

@ApiTags('Subscription')
@Controller('subscription')
export class SubscriptionController {
  private readonly logger = new Logger(SubscriptionController.name);

  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly entitlementService: EntitlementService,
    @InjectQueue('telegram') private readonly telegramQueue: Queue,
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
  @ApiOperation({ summary: 'Assign or update a subscription plan for a user and immediately trigger Telegram alerts' })
  async assignPlan(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: AssignPlanDto,
  ) {
    const subscription = await this.subscriptionService.assignPlan(userId, dto);

    // Immediately trigger Telegram alert dispatch for this user
    try {
      await this.telegramQueue.add(
        'send-user-telegram-alerts',
        { userId },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
      this.logger.log(`Enqueued immediate Telegram alerts for user ${userId} following plan assignment.`);
    } catch (err: any) {
      this.logger.error(`Failed to enqueue Telegram alert for user ${userId}: ${err.message || err}`);
    }

    return subscription;
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

  @Post('waitlist')
  @Public()
  @ApiOperation({ summary: 'Register for a plan waitlist (e.g. PRO / ENTERPRISE)' })
  async joinWaitlist(
    @Req() req,
    @Body() dto: JoinWaitlistDto,
  ) {
    const userId = req.user?.id;
    const authHeader = req.headers?.authorization;
    return this.subscriptionService.joinWaitlist(dto, userId, authHeader);
  }


  @Get('waitlist/stats')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearerAuth')
  @ApiOperation({ summary: 'Get waitlist demand statistics (Admin / Internal)' })
  async getWaitlistStats() {
    return this.subscriptionService.getWaitlistStats();
  }
}

