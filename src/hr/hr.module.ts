import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Cv } from 'src/Entities/cv.entity';
import { User } from 'src/Entities/user.entity';
import { HrCvAccess } from 'src/Entities/hr-cv-access.entity';
import { HrPipelineEntry } from 'src/Entities/hr-pipeline-entry.entity';
import { HrPipelineEvent } from 'src/Entities/hr-pipeline-event.entity';
import { HrCandidateNote } from 'src/Entities/hr-candidate-note.entity';
import { HrVacancy } from 'src/Entities/hr-vacancy.entity';
import { CvModule } from 'src/cv/cv.module';
import { LinkedinSearchModule } from 'src/linkedin-search/linkedin-search.module';
import { HrController } from './hr.controller';
import { HrCandidatesService } from './hr-candidates.service';
import { HrPipelineService } from './hr-pipeline.service';
import { HrVacancyService } from './hr-vacancy.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Cv, User, HrCvAccess, HrPipelineEntry, HrPipelineEvent, HrCandidateNote, HrVacancy]),
    CvModule,
    LinkedinSearchModule,
  ],
  controllers: [HrController],
  providers: [HrCandidatesService, HrPipelineService, HrVacancyService],
})
export class HrModule {}
