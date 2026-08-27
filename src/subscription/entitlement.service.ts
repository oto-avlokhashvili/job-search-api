import { Injectable } from '@nestjs/common';
import { User } from 'src/Entities/user.entity';
import { SubscriptionPlan, SubscriptionStatus } from 'src/enums/subscriptions.enum';
import { DEFAULT_UNPAID_FEATURES, PLAN_POLICIES, PlanFeatures } from './subscription.config';

@Injectable()
export class EntitlementService {
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
}
