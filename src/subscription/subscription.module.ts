import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { BullModule } from '@nestjs/bullmq';
import { Subscription } from 'src/Entities/subscription.entity';
import { User } from 'src/Entities/user.entity';
import { ChatUsage } from 'src/Entities/chat-usage.entity';
import { Waitlist } from 'src/Entities/waitlist.entity';
import { EntitlementService } from './entitlement.service';
import { SubscriptionService } from './subscription.service';
import { SubscriptionController } from './subscription.controller';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([Subscription, User, ChatUsage, Waitlist]),
    JwtModule.register({}),
    BullModule.registerQueue({
      name: 'telegram',
    }),
  ],
  controllers: [SubscriptionController],
  providers: [EntitlementService, SubscriptionService],
  exports: [EntitlementService, SubscriptionService, TypeOrmModule],
})
export class SubscriptionModule {}
