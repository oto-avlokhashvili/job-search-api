import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription } from 'src/Entities/subscription.entity';
import { User } from 'src/Entities/user.entity';
import { SubscriptionPlan, SubscriptionStatus } from 'src/enums/subscriptions.enum';
import { AssignPlanDto } from './dto/update-subscription.dto';

@Injectable()
export class SubscriptionService {
  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /**
   * Retrieves subscription details for a specific user ID.
   */
  async getSubscription(userId: number): Promise<Subscription | null> {
    return this.subscriptionRepo.findOne({ where: { userId } });
  }

  /**
   * Assigns, activates, or upgrades a plan for a user.
   * Creates a new Subscription record if none exists, or updates the existing one.
   */
  async assignPlan(userId: number, dto: AssignPlanDto): Promise<Subscription> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const durationDays = dto.durationDays ?? 30;
    const now = new Date();
    const periodEnd = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    let subscription = await this.subscriptionRepo.findOne({ where: { userId } });

    if (!subscription) {
      subscription = this.subscriptionRepo.create({
        userId,
        plan: dto.plan,
        status: dto.status ?? SubscriptionStatus.ACTIVE,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        providerCustomerId: dto.providerCustomerId ?? null,
        providerSubscriptionId: dto.providerSubscriptionId ?? null,
      });
    } else {
      subscription.plan = dto.plan;
      subscription.status = dto.status ?? SubscriptionStatus.ACTIVE;
      subscription.currentPeriodStart = now;
      subscription.currentPeriodEnd = periodEnd;
      subscription.cancelAtPeriodEnd = false;
      if (dto.providerCustomerId !== undefined) {
        subscription.providerCustomerId = dto.providerCustomerId;
      }
      if (dto.providerSubscriptionId !== undefined) {
        subscription.providerSubscriptionId = dto.providerSubscriptionId;
      }
    }

    return this.subscriptionRepo.save(subscription);
  }

  /**
   * Extends the existing subscription's periodEnd by additional days upon successful renewal.
   */
  async renewSubscription(userId: number, additionalDays: number = 30): Promise<Subscription> {
    const subscription = await this.subscriptionRepo.findOne({ where: { userId } });
    if (!subscription) {
      throw new NotFoundException(`No subscription found for user ID ${userId}`);
    }

    const baseDate =
      subscription.currentPeriodEnd && new Date(subscription.currentPeriodEnd) > new Date()
        ? new Date(subscription.currentPeriodEnd)
        : new Date();

    subscription.currentPeriodEnd = new Date(
      baseDate.getTime() + additionalDays * 24 * 60 * 60 * 1000,
    );
    subscription.status = SubscriptionStatus.ACTIVE;
    subscription.cancelAtPeriodEnd = false;

    return this.subscriptionRepo.save(subscription);
  }

  /**
   * Cancels a subscription. If cancelImmediately is false, keeps status active until currentPeriodEnd.
   */
  async cancelSubscription(userId: number, cancelImmediately: boolean = false): Promise<Subscription> {
    const subscription = await this.subscriptionRepo.findOne({ where: { userId } });
    if (!subscription) {
      throw new NotFoundException(`No subscription found for user ID ${userId}`);
    }

    if (cancelImmediately) {
      subscription.status = SubscriptionStatus.CANCELED;
      subscription.currentPeriodEnd = new Date(); // Expire immediately
      subscription.cancelAtPeriodEnd = false;
    } else {
      subscription.cancelAtPeriodEnd = true;
    }

    return this.subscriptionRepo.save(subscription);
  }

  /**
   * Removes subscription completely (e.g. account reset / purge)
   */
  async removeSubscription(userId: number): Promise<void> {
    await this.subscriptionRepo.delete({ userId });
  }
}
