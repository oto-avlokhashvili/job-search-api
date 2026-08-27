import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Subscription } from 'src/Entities/subscription.entity';
import { User } from 'src/Entities/user.entity';
import { EntitlementService } from './entitlement.service';
import { SubscriptionService } from './subscription.service';
import { SubscriptionController } from './subscription.controller';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Subscription, User])],
  controllers: [SubscriptionController],
  providers: [EntitlementService, SubscriptionService],
  exports: [EntitlementService, SubscriptionService, TypeOrmModule],
})
export class SubscriptionModule {}
