import { Controller, Get, Post, Body, Req, UseGuards } from '@nestjs/common';
import { AiService } from './ai.service';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { SubscriptionGuard } from 'src/auth/guards/subscription.guard';
import { RequireSubscription } from 'src/auth/decorators/subscription.decorator';
import { SubscriptionPlan } from 'src/enums/subscriptions.enum';
import { EntitlementService } from 'src/subscription/entitlement.service';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

@Controller('ai')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly entitlementService: EntitlementService,
  ) {}

  @Post('search-job')
  @UseGuards(JwtAuthGuard, SubscriptionGuard)
  @RequireSubscription(SubscriptionPlan.PRO)
  @ApiBearerAuth('bearerAuth')
  async searchJob(@Req() req) {
    return this.aiService.jobsearchWithCv(req.user.id);
  }

  @Get('chat-quota')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearerAuth')
  @ApiOperation({ summary: 'Get current daily chat usage and remaining quota' })
  async getChatQuota(@Req() req) {
    const quota = await this.entitlementService.getDailyChatQuota(req.user);
    const plan = this.entitlementService.getEffectivePlan(req.user);
    return {
      ...quota,
      plan,
      isPro: plan === SubscriptionPlan.PRO,
    };
  }

  @Post('chat')
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 600000 } }) // Limit to max 5 requests per 10 minutes
  @ApiBearerAuth('bearerAuth')
  @ApiOperation({ summary: 'Send a prompt to the career assistant (rate-limited to 5/10m + daily plan quota)' })
  @ApiConsumes('application/json')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string' },
      },
    },
  })
  async chat(
    @Body() body: { prompt: string; history?: { role: 'user' | 'model'; text: string }[] },
    @Req() req,
  ) {
    // Validate and consume daily quota (Throws 402 if unpaid, 429 if 3/3 daily limit exceeded)
    const quota = await this.entitlementService.consumeDailyChatQuota(req.user);

    const result = await this.aiService.chat(req.user.id, body.prompt, body.history);
    return {
      ...result,
      quota,
    };
  }
}
