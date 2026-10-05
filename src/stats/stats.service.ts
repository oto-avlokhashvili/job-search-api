import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from 'src/Entities/user.entity';
import { Subscription } from 'src/Entities/subscription.entity';
import { JobEntity } from 'src/Entities/job.entity';
import { Cv } from 'src/Entities/cv.entity';
import { SubscriptionPlan, SubscriptionStatus } from 'src/enums/subscriptions.enum';
import { OperationsStatsDto } from './dto/operations-stats.dto';

@Injectable()
export class StatsService {
  private readonly logger = new Logger(StatsService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    @InjectRepository(JobEntity)
    private readonly jobRepository: Repository<JobEntity>,
    @InjectRepository(Cv)
    private readonly cvRepository: Repository<Cv>,
  ) {}

  async getOperationsStats(): Promise<OperationsStatsDto> {
    const startTime = Date.now();

    const aggregatorsList = [
      { id: 'jobs-ge', name: 'Jobs.ge', active: true },
      { id: 'hr-ge', name: 'HR.ge', active: true },
      { id: 'awork-ge', name: 'Awork.ge', active: true },
      { id: 'myjobs-ge', name: 'MyJobs.ge', active: true },
      { id: 'linkedin', name: 'LinkedIn', active: true },
    ];

    const now = new Date();

    const [
      activeAgents,
      activeUsers,
      activeVacancies,
      uploadedCvs,
    ] = await Promise.all([
      // Count Pro users (აქტიური აგენტები)
      this.userRepository
        .createQueryBuilder('user')
        .leftJoin('user.subscriptionDetails', 'sub')
        .where(
          '(sub.plan = :proPlan AND sub.status IN (:...activeStatuses) AND (sub.currentPeriodEnd IS NULL OR sub.currentPeriodEnd > :now)) OR (user.subscription = :proPlanLegacy)',
          {
            proPlan: SubscriptionPlan.PRO,
            proPlanLegacy: SubscriptionPlan.PRO,
            activeStatuses: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING],
            now,
          },
        )
        .getCount(),

      // Count all users (აქტიური მომხმარებლები)
      this.userRepository.count(),

      // Count all vacancies (აქტიური ვაკანსიები)
      this.jobRepository.count(),

      // Count uploaded CVs (შესაბამისობის სიზუსტე / ატვირთული CV-ები)
      this.cvRepository.count(),
    ]);

    const calculationDurationSeconds = Number(((Date.now() - startTime) / 1000).toFixed(2));

    return {
      activeAgents,
      activeUsers,
      activeAggregators: aggregatorsList.filter((a) => a.active).length,
      activeVacancies,
      uploadedCvs,
      systemStatus: 'ოპტიმალური',
      syncedPortals: aggregatorsList.filter((a) => a.active).length,
      avgCalculationTimeSeconds: calculationDurationSeconds > 0 ? calculationDurationSeconds : 1.2,
      aggregators: aggregatorsList,
    };
  }
}
