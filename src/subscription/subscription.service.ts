import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { Subscription } from 'src/Entities/subscription.entity';
import { User } from 'src/Entities/user.entity';
import { Waitlist } from 'src/Entities/waitlist.entity';
import { SubscriptionPlan, SubscriptionStatus } from 'src/enums/subscriptions.enum';
import { AssignPlanDto } from './dto/update-subscription.dto';
import { JoinWaitlistDto } from './dto/join-waitlist.dto';

@Injectable()
export class SubscriptionService {
  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Waitlist)
    private readonly waitlistRepo: Repository<Waitlist>,
    private readonly jwtService: JwtService,
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

  /**
   * Registers a user or guest email for a plan waitlist (e.g. PRO / ENTERPRISE).
   */
  async joinWaitlist(
    dto: JoinWaitlistDto,
    userId?: number,
    authHeader?: string,
  ): Promise<{ success: boolean; message: string; alreadyJoined: boolean; data: Waitlist }> {

    let email = dto.email?.trim().toLowerCase();

    // 1. If userId is not passed, attempt extracting it from the Authorization Bearer token header
    if (!userId && authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      try {
        const decoded: any = this.jwtService.decode(token);
        if (decoded && (decoded.sub || decoded.id)) {
          userId = Number(decoded.sub || decoded.id);
        }
      } catch (err) {
        // Continue fallback to email in DTO
      }
    }

    // 2. If authenticated userId found, automatically lookup and insert user's email
    if (userId) {
      const user = await this.userRepo.findOne({ where: { id: userId } });
      if (user && user.email) {
        email = user.email.trim().toLowerCase();
      }
    }

    if (!email) {
      throw new BadRequestException('გთხოვთ მიუთითოთ ელ-ფოსტის მისამართი');
    }


    const plan = (dto.plan || 'PRO').trim().toUpperCase();
    const source = dto.source || 'landing';

    const existing = await this.waitlistRepo.findOne({
      where: { email, plan },
    });

    if (existing) {
      return {
        success: true,
        message: 'თქვენ უკვე დარეგისტრირებული ხართ ამ პაკეტის Waitlist-ში!',
        alreadyJoined: true,
        data: existing,
      };
    }

    const entry = this.waitlistRepo.create({
      email,
      userId: userId ?? null,
      plan,
      source,
      notes: dto.notes ?? null,
    });

    const saved = await this.waitlistRepo.save(entry);

    return {
      success: true,
      message: 'გმადლობთ! თქვენ წარმატებით დაემატეთ Waitlist-ში 🎉',
      alreadyJoined: false,
      data: saved,
    };
  }

  /**
   * Retrieves aggregate waitlist statistics for admin/metrics inspection.
   */
  async getWaitlistStats(): Promise<{ total: number; proCount: number; enterpriseCount: number; list: Waitlist[] }> {
    const total = await this.waitlistRepo.count();
    const proCount = await this.waitlistRepo.count({ where: { plan: 'PRO' } });
    const enterpriseCount = await this.waitlistRepo.count({ where: { plan: 'ENTERPRISE' } });
    const list = await this.waitlistRepo.find({
      order: { createdAt: 'DESC' },
      take: 100,
    });

    return {
      total,
      proCount,
      enterpriseCount,
      list,
    };
  }
}

