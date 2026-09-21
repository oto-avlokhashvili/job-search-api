import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/Entities/user.entity';
import { Subscription } from 'src/Entities/subscription.entity';
import { JobEntity } from 'src/Entities/job.entity';
import { Cv } from 'src/Entities/cv.entity';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Subscription, JobEntity, Cv]),
  ],
  controllers: [StatsController],
  providers: [StatsService],
  exports: [StatsService],
})
export class StatsModule {}
