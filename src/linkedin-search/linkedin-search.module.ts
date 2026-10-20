import { Module } from '@nestjs/common';
import { LinkedinSearchController } from './linkedin-search.controller';
import { LinkedinSearchService } from './linkedin-search.service';
import { GoogleBrowserService } from './google-browser.service';

@Module({
  controllers: [LinkedinSearchController],
  providers: [LinkedinSearchService, GoogleBrowserService],
})
export class LinkedinSearchModule {}
