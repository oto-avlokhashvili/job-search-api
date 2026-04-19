import {
  Controller, Post, Get, Delete,
  UseGuards, UseInterceptors, UploadedFile,
  Req, HttpCode, HttpStatus,
  Body,
  Param,
  ParseIntPipe,
  Patch,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  ApiTags, ApiConsumes, ApiBody, ApiOperation,
  ApiOkResponse, ApiNoContentResponse, ApiBearerAuth
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CvService } from './cv.service';
import { Cv } from 'src/Entities/cv.entity';
import { CvFileValidationPipe } from './cv-file-validation.pipe';
import { UpdateCvSummaryDto } from './dto/update-cv.dto';


@ApiTags('CV')
@ApiBearerAuth()
@Controller('cv')
@UseGuards(JwtAuthGuard)
export class CvController {
  constructor(private readonly cvService: CvService) {}
  @ApiBearerAuth('bearerAuth')
  @Post('upload')
  @ApiOperation({ summary: 'Upload or replace your CV' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'PDF or Word document, max 5MB',
        },
      },
    },
  })
  @ApiOkResponse({ type: Cv })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async upload(
    @UploadedFile(CvFileValidationPipe) file: Express.Multer.File,
    @Req() req,
  ) {
    console.log('req.user:', req.user);
    console.log('headers:', req.headers.authorization);
    return this.cvService.uploadCv(req.user.id, file);
  }
  @ApiBearerAuth('bearerAuth')
  @Get()
  @ApiOperation({ summary: 'Get your current CV' })
  @ApiOkResponse({ type: Cv })
  async getMyCv(@Req() req) {
    return this.cvService.getCvByUser(req.user.id);
  }
  
  @ApiBearerAuth('bearerAuth')
  @Delete()
  @ApiOperation({ summary: 'Delete your current CV' })
  @ApiNoContentResponse({ description: 'CV deleted successfully' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMyCv(@Req() req) {
    return this.cvService.deleteCv(req.user.id);
  }

  // cv.controller.ts
@Patch('cv-summary')
@ApiBearerAuth('bearerAuth')
@ApiBody({ type: UpdateCvSummaryDto, required: false })
updateSummary(
  @Req() req,
  @Body() dto: UpdateCvSummaryDto ,
) {
  return this.cvService.updateSummary(req.user.id, dto);
}
}