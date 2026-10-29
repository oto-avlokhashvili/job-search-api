import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { CompanyEntity } from 'src/Entities/company.entity';
import { JobEntity } from 'src/Entities/job.entity';
import { COMPANY_LOGO_QUEUE, CompanyLogoService } from './company-logo.service';
import { CompanyLogoProcessor } from './company-logo.processor';
import { LogoStorageService } from './logo-storage.service';

@Module({
  imports: [TypeOrmModule.forFeature([CompanyEntity, JobEntity]), BullModule.registerQueue({ name: COMPANY_LOGO_QUEUE })],
  providers: [CompanyLogoService, CompanyLogoProcessor, LogoStorageService],
  exports: [CompanyLogoService],
})
export class CompaniesModule {}
