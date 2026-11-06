/**
 * Adds the HR filter facts (employers, universities, languages, years of experience) to every CV's
 * summary, throttled to leave half of the AI quota for the site (see src/cv/cv-reanalysis.ts).
 *
 * Standalone on purpose: it opens only the CV table, file storage and the AI summarizer, never the
 * whole API (whose schedulers would run too). It doesn't change the database schema.
 *
 *   npx ts-node -T -r tsconfig-paths/register scripts/reanalyze-cvs.ts            # all pending CVs
 *   npx ts-node -T -r tsconfig-paths/register scripts/reanalyze-cvs.ts --limit 1  # a trial on one CV
 *
 * Safe to stop at any time and start again: it picks up the CVs that still lack the facts.
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
dotenv.config();

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { pgConfig } from '../dbConfig';
import { Cv } from 'src/Entities/cv.entity';
import { R2StorageService } from 'src/cv/r2-storage.service';
import { CvParserService } from 'src/cv/cv-parser.service';
import { AiService } from 'src/ai/ai.service';
import { CvReanalysis } from 'src/cv/cv-reanalysis';

async function main() {
  const limitArg = process.argv.indexOf('--limit');
  const maxCvs = limitArg > 0 ? Number(process.argv[limitArg + 1]) : undefined;
  const logger = new Logger('ReanalyzeCvs');

  // Only the CV table; never synchronize the schema from a script
  const dataSource = new DataSource({ ...pgConfig, entities: [Cv], synchronize: false });
  await dataSource.initialize();

  // summarizeCv only needs the config and the CV parser; the AI service's other collaborators stay unset
  const ai = new (AiService as any)(new ConfigService(), null, null, null, null, new CvParserService(), null, null) as AiService;
  const r2 = new R2StorageService();

  const job = new CvReanalysis({
    repo: dataSource.getRepository(Cv),
    download: (path) => r2.downloadFile(path),
    summarize: (file) => ai.summarizeCv(file),
    logger,
    maxCvs,
  });

  const before = await job.status();
  logger.log(
    `Starting: ${before.remaining} CVs pending, at most ${before.limits.perMinute}/min and ${before.limits.perDay}/day` +
      (maxCvs !== undefined ? `, stopping after ${maxCvs}` : ''),
  );
  const { finished } = job.start();
  await finished;

  const after = await job.status();
  logger.log(`Finished: ${after.done} done, ${after.failed} failed, ${after.remaining} still pending`);
  await dataSource.destroy();
}

main().catch((e) => {
  console.error('Re-analysis script failed:', e);
  process.exit(1);
});
