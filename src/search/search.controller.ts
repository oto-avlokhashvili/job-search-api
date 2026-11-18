import { Controller, Get, Header, NotFoundException, Param, ParseIntPipe, Query, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ClientIpThrottlerGuard } from 'src/auth/guards/client-ip-throttler.guard';
import { InternalKeyGuard } from 'src/auth/guards/internal-key.guard';
import { FilterJobDto } from 'src/job/dto/filter-job.dto';
import { SearchService } from './search.service';

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @UseGuards(ClientIpThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } }) // sentences cost an AI call
  @ApiOperation({
    summary: 'AI vacancy search: a sentence is turned into keywords, city and category; at most 60 results',
  })
  @ApiQuery({ name: 'query', required: false, type: String, example: 'მინდა ბუღალტრად ვიმუშაო ბათუმში' })
  @ApiQuery({ name: 'location', required: false, type: String })
  @ApiQuery({ name: 'category', required: false, type: String })
  @ApiQuery({ name: 'source', required: false, type: String })
  @ApiQuery({ name: 'salary', required: false, type: String })
  @ApiQuery({ name: 'publishDate', required: false, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Max 30' })
  @Get()
  search(@Query() filter: FilterJobDto) {
    return this.searchService.search(filter);
  }

  @UseGuards(ClientIpThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({ summary: 'Frequently searched texts (anonymous, recent, with results), for the home page chips' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Max 20' })
  @Header('Cache-Control', 'public, max-age=600')
  @Get('popular')
  async popular(@Query('limit') limit?: string) {
    return { queries: await this.searchService.popularQueries(Number(limit) || 10) };
  }

  @UseGuards(ClientIpThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({ summary: 'Counts the click and redirects to the vacancy\'s original posting' })
  @Get('go/:id')
  async go(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const url = await this.searchService.clickOut(id);
    if (!url) throw new NotFoundException('Vacancy not found');
    res.redirect(302, url);
  }

  @ApiSecurity('internalKey')
  @UseGuards(InternalKeyGuard)
  @ApiOperation({ summary: 'Most searched texts and click-outs per site, to pick new keyword pages' })
  @Get('stats')
  async stats(@Query('days') days?: string) {
    const d = Math.min(Math.max(Number(days) || 30, 1), 365);
    const [queries, clicks] = await Promise.all([this.searchService.topQueries(d), this.searchService.clicksBySite(d)]);
    return { days: d, queries, clicks };
  }
}
