import { SetMetadata } from '@nestjs/common';
import { SubscriptionPlan } from 'src/enums/subscriptions.enum';

export const REQUIRED_SUBSCRIPTION_KEY = 'required_subscription';

/**
 * Decorator to enforce subscription plan requirements on routes/controllers.
 * Example: @RequireSubscription(SubscriptionPlan.PRO)
 * Example: @RequireSubscription(SubscriptionPlan.BASIC, SubscriptionPlan.PRO)
 */
export const RequireSubscription = (...plans: SubscriptionPlan[]) =>
  SetMetadata(REQUIRED_SUBSCRIPTION_KEY, plans);
