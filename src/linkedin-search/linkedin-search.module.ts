import { Module } from '@nestjs/common';
import { LinkedinSearchService } from './linkedin-search.service';
import { GoogleBrowserService } from './google-browser.service';
import { SearloSearchService } from './searlo-search.service';
import { CvModule } from 'src/cv/cv.module';

// Served to HRs through /hr/candidates/linkedin (HrModule), which adds the per-HR quota.
// Searlo's API first, the own Google browser as the fallback.
@Module({
  imports: [CvModule],
  providers: [LinkedinSearchService, SearloSearchService, GoogleBrowserService],
  exports: [LinkedinSearchService],
})
export class LinkedinSearchModule {}
