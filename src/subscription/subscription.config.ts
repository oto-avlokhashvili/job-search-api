import { SubscriptionPlan } from 'src/enums/subscriptions.enum';

export interface PlanFeatures {
  maxDailyJobs: number;
  aiModel: 'gemini-flash' | 'gemini-pro';
  includeSalaryAnalysis: boolean;
  enableTelegramAlerts: boolean;
  enableEmailAlerts: boolean;
  canUseAiChat: boolean;
  canUseAiJobSearch: boolean;
  maxDailyChatMessages: number;
}

/**
 * Default features for users with no paid subscription (subscriptionDetails === null)
 */
export const DEFAULT_UNPAID_FEATURES: PlanFeatures = {
  maxDailyJobs: 3,
  aiModel: 'gemini-flash',
  includeSalaryAnalysis: false,
  enableTelegramAlerts: false,
  enableEmailAlerts: false,
  canUseAiChat: false,
  canUseAiJobSearch: false,
  maxDailyChatMessages: 0,
};

/**
 * Feature capabilities for paid subscription tiers
 */
export const PLAN_POLICIES: Record<SubscriptionPlan, PlanFeatures> = {
  [SubscriptionPlan.BASIC]: {
    maxDailyJobs: 10,
    aiModel: 'gemini-flash',
    includeSalaryAnalysis: false,
    enableTelegramAlerts: true,
    enableEmailAlerts: false,
    canUseAiChat: true,
    canUseAiJobSearch: false,
    maxDailyChatMessages: 3,
  },
  [SubscriptionPlan.PRO]: {
    maxDailyJobs: Infinity,
    aiModel: 'gemini-pro',
    includeSalaryAnalysis: true,
    enableTelegramAlerts: true,
    enableEmailAlerts: true,
    canUseAiChat: true,
    canUseAiJobSearch: true,
    maxDailyChatMessages: Infinity,
  },
};
