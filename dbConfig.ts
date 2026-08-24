import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import * as dotenv from 'dotenv';

// Load environment variables from .env file before static configuration evaluation
dotenv.config();

const isLocal =
  !process.env.DATABASE_URL ||
  process.env.DATABASE_URL.includes('localhost') ||
  process.env.DATABASE_URL.includes('127.0.0.1');

export const pgConfig: PostgresConnectionOptions = {
  url: process.env.DATABASE_URL,
  type: 'postgres',
  entities: [__dirname + '/**/*.entity{.ts,.js}'],
  synchronize: true,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  extra: {
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  },
};

