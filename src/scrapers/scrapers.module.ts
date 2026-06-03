import { Module } from '@nestjs/common';
import { HrGeScraperService } from './hr-ge-scraper.service';
import { ScrapersController } from './scrapers.controller';

@Module({
  providers: [HrGeScraperService],
  // If you plan to use this service in other modules (like a JobsModule), 
  // export it here:
  exports: [HrGeScraperService],
  controllers: [ScrapersController], 
})
export class ScrapersModule {}
