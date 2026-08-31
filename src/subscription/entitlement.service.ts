import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from 'src/Entities/user.entity';
import { ChatUsage } from 'src/Entities/chat-usage.entity';
import { SubscriptionPlan, SubscriptionStatus } from 'src/enums/subscriptions.enum';
import { DEFAULT_UNPAID_FEATURES, PLAN_POLICIES, PlanFeatures } from './subscription.config';

@Injectable()
export class EntitlementService {
  constructor(
    @InjectRepository(ChatUsage)
    private readonly chatUsageRepo: Repository<ChatUsage>,
  ) {}

  /**
   * Returns today's date formatted as YYYY-MM-DD
   */
  private getTodayDateString(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Resolves the effective subscription plan for a user.
   * Returns SubscriptionPlan (BASIC or PRO) if active and valid, or null if no active paid subscription exists.
   */
  getEffectivePlan(user: User): SubscriptionPlan | null {
    if (!user) return null;

    const sub = user.subscriptionDetails;
    if (sub) {
      const isStatusValid =
        sub.status === SubscriptionStatus.ACTIVE ||
        sub.status === SubscriptionStatus.TRIALING;

      const isPeriodValid = sub.currentPeriodEnd
        ? new Date(sub.currentPeriodEnd) > new Date()
        : true;

      if (isStatusValid && isPeriodValid) {
        return sub.plan;
      }

      // If subscription has expired or is inactive, return null (unpaid default)
      return null;
    }

    // Fallback to legacy column during transition period if present
    if (user.subscription && Object.values(SubscriptionPlan).includes(user.subscription as unknown as SubscriptionPlan)) {
      return user.subscription as unknown as SubscriptionPlan;
    }

    return null;
  }

  /**
   * Returns feature capability flags and limits for the user.
   */
  getFeaturesForUser(user: User): PlanFeatures {
    const plan = this.getEffectivePlan(user);
    if (!plan) {
      return DEFAULT_UNPAID_FEATURES;
    }
    return PLAN_POLICIES[plan] || DEFAULT_UNPAID_FEATURES;
  }

  canReceiveTelegramAlerts(user: User): boolean {
    const features = this.getFeaturesForUser(user);
    return features.enableTelegramAlerts;
  }

  canReceiveEmailAlerts(user: User): boolean {
    const features = this.getFeaturesForUser(user);
    return features.enableEmailAlerts;
  }

  getDailyJobLimit(user: User): number {
    const features = this.getFeaturesForUser(user);
    return features.maxDailyJobs;
  }

  canUseAiJobSearch(user: User): boolean {
    const features = this.getFeaturesForUser(user);
    return features.canUseAiJobSearch;
  }

  /**
   * Retrieves current daily AI chat message quota and usage for a user.
   */
  async getDailyChatQuota(user: User): Promise<{ used: number; limit: number; remaining: number }> {
    const features = this.getFeaturesForUser(user);
    const limit = features.maxDailyChatMessages;

    if (limit === Infinity) {
      return { used: 0, limit: Infinity, remaining: Infinity };
    }

    const today = this.getTodayDateString();
    const usage = await this.chatUsageRepo.findOne({
      where: { userId: user.id, date: today },
    });

    const used = usage?.count ?? 0;
    const remaining = Math.max(0, limit - used);

    return { used, limit, remaining };
  }

  /**
   * Validates and consumes 1 chat request against the user's daily quota.
   * Throws 402 if unpaid, or 429 if daily limit is exceeded.
   */
  async consumeDailyChatQuota(user: User): Promise<{ used: number; limit: number; remaining: number }> {
    const features = this.getFeaturesForUser(user);
    const limit = features.maxDailyChatMessages;

    if (limit === 0) {
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYMENT_REQUIRED,
          message: 'AI ჩატის გამოყენებისთვის გთხოვთ გაიაქტიუროთ Basic ან Pro სააბონენტო პაკეტი.',
          error: 'Payment Required',
          requiredPlans: [SubscriptionPlan.BASIC, SubscriptionPlan.PRO],
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    if (limit === Infinity) {
      return { used: 0, limit: Infinity, remaining: Infinity };
    }

    const today = this.getTodayDateString();
    let usage = await this.chatUsageRepo.findOne({
      where: { userId: user.id, date: today },
    });

    if (!usage) {
      usage = this.chatUsageRepo.create({
        userId: user.id,
        date: today,
        count: 0,
      });
    }

    if (usage.count >= limit) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `დღიური AI ჩატის მოთხოვნების ლიმიტი (${limit}/${limit}) ამოწურულია. შეუზღუდავი წვდომისთვის განაახლეთ Pro პაკეტზე.`,
          error: 'Daily Chat Limit Reached',
          used: usage.count,
          limit,
          remaining: 0,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    usage.count += 1;
    await this.chatUsageRepo.save(usage);

    return {
      used: usage.count,
      limit,
      remaining: limit - usage.count,
    };
  }
}
