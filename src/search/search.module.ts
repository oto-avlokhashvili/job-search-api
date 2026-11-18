import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from 'src/ai/ai.module';
import { JobEntity } from 'src/Entities/job.entity';
import { JobClickEntity } from 'src/Entities/job-click.entity';
import { SearchQueryEntity } from 'src/Entities/search-query.entity';
import { JobModule } from 'src/job/job.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

/** Its own module: it uses both JobModule and AiModule, and AiModule already depends on JobModule. */
@Module({
  imports: [TypeOrmModule.forFeature([JobEntity, JobClickEntity, SearchQueryEntity]), JobModule, AiModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
