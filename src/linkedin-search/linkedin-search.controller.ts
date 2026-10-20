import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { ClientIpThrottlerGuard } from 'src/auth/guards/client-ip-throttler.guard';
import { LinkedinSearchService } from './linkedin-search.service';
import { LinkedinSearchDto } from './dto/linkedin-search.dto';

@ApiTags('LinkedIn Search')
@ApiBearerAuth('bearerAuth')
@Controller('linkedin-search')
@UseGuards(JwtAuthGuard, ClientIpThrottlerGuard)
export class LinkedinSearchController {
  constructor(private readonly linkedinSearchService: LinkedinSearchService) {}

  @Get()
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // Each uncached call drives a real Google search
  @ApiOperation({ summary: 'Search open-to-work LinkedIn profiles via Google (site:linkedin.com/in)' })
  async search(@Query() dto: LinkedinSearchDto) {
    return this.linkedinSearchService.search(dto);
  }
}
