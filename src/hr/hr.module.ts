import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Cv } from 'src/Entities/cv.entity';
import { User } from 'src/Entities/user.entity';
import { HrCvAccess } from 'src/Entities/hr-cv-access.entity';
import { HrPipelineEntry } from 'src/Entities/hr-pipeline-entry.entity';
import { HrPipelineEvent } from 'src/Entities/hr-pipeline-event.entity';
import { HrCandidateNote } from 'src/Entities/hr-candidate-note.entity';
import { HrVacancy } from 'src/Entities/hr-vacancy.entity';
import { HrInterview } from 'src/Entities/hr-interview.entity';
import { EmailModule } from 'src/email/email.module';
import { CvModule } from 'src/cv/cv.module';
import { LinkedinSearchModule } from 'src/linkedin-search/linkedin-search.module';
import { HrController } from './hr.controller';
import { HrCandidatesService } from './hr-candidates.service';
import { HrPipelineService } from './hr-pipeline.service';
import { HrVacancyService } from './hr-vacancy.service';
import { HrInterviewService, INTERVIEW_QUEUE } from './hr-interview.service';
import { HrInterviewProcessor } from './hr-interview.processor';
import { InterviewPublicController } from './interview-public.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Cv, User, HrCvAccess, HrPipelineEntry, HrPipelineEvent, HrCandidateNote, HrVacancy, HrInterview]),
    BullModule.registerQueue({ name: INTERVIEW_QUEUE }),
    EmailModule,
    CvModule,
    LinkedinSearchModule,
  ],
  controllers: [HrController, InterviewPublicController],
  providers: [HrCandidatesService, HrPipelineService, HrVacancyService, HrInterviewService, HrInterviewProcessor],
})
export class HrModule {}
