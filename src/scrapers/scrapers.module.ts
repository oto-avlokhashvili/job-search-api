import { Module } from '@nestjs/common';
import { HrGeScraperService } from './hr-ge-scraper.service';
import { ScrapersController } from './scrapers.controller';
import { JobsGeScraperService } from './jobs-ge.scraper';
import { AworkGeScraperService } from './awork-ge.scraper';
import { MyjobsGeScraperService } from './myjobs-ge.scraper';

@Module({
  imports: [],
  providers: [HrGeScraperService, JobsGeScraperService, AworkGeScraperService, MyjobsGeScraperService],
  // If you plan to use this service in other modules (like a JobsModule), 
  // export it here:
  exports: [HrGeScraperService, JobsGeScraperService, AworkGeScraperService, MyjobsGeScraperService],
  controllers: [ScrapersController], 
})
export class ScrapersModule {}

