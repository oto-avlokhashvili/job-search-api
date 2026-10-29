import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { COMPANY_LOGO_QUEUE, CompanyLogoJob, CompanyLogoService } from './company-logo.service';

// Two logos at a time and at most ~5 a second: polite to the sites the logos come from
@Processor(COMPANY_LOGO_QUEUE, { concurrency: 2, limiter: { max: 5, duration: 1000 } })
export class CompanyLogoProcessor extends WorkerHost {
  constructor(private readonly logoService: CompanyLogoService) {
    super();
  }

  async process(job: Job<CompanyLogoJob>): Promise<void> {
    await this.logoService.process(job.data.companyId);
  }
}
