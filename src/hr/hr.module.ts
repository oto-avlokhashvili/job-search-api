import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Cv } from 'src/Entities/cv.entity';
import { User } from 'src/Entities/user.entity';
import { HrCvAccess } from 'src/Entities/hr-cv-access.entity';
import { CvModule } from 'src/cv/cv.module';
import { LinkedinSearchModule } from 'src/linkedin-search/linkedin-search.module';
import { HrController } from './hr.controller';
import { HrCandidatesService } from './hr-candidates.service';

@Module({
  imports: [TypeOrmModule.forFeature([Cv, User, HrCvAccess]), CvModule, LinkedinSearchModule],
  controllers: [HrController],
  providers: [HrCandidatesService],
})
export class HrModule {}
