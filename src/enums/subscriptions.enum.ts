export enum SubscriptionPlan {
    BASIC = 'BASIC',
    PRO = 'PRO',
}

export enum SubscriptionStatus {
    ACTIVE = 'ACTIVE',
    TRIALING = 'TRIALING',
    PAST_DUE = 'PAST_DUE',
    CANCELED = 'CANCELED',
    EXPIRED = 'EXPIRED',
}

export const Subscription = SubscriptionPlan;
export type Subscription = SubscriptionPlan;