import { JobEntity } from 'src/Entities/job.entity';
import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

export const pgConfig: PostgresConnectionOptions = {
  url: 'postgresql://neondb_owner:npg_3TXt6igOGDkm@ep-flat-shape-aha6lxtq-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
  type: 'postgres',
  port: 3306,
  entities: [__dirname+'/**/*.entity{.ts,.js}'],
  synchronize: true,
};
