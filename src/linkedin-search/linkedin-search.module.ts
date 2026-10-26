import { Module } from '@nestjs/common';
import { LinkedinSearchService } from './linkedin-search.service';
import { GoogleBrowserService } from './google-browser.service';
import { CvModule } from 'src/cv/cv.module';

// Served to HRs through /hr/candidates/linkedin (HrModule), which adds the per-HR quota.
@Module({
  imports: [CvModule],
  providers: [LinkedinSearchService, GoogleBrowserService],
  exports: [LinkedinSearchService],
})
export class LinkedinSearchModule {}
