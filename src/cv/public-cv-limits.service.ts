import { HttpException, HttpStatus, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Redis-backed counters and cache for the anonymous CV upload/search flow.
 * Uses the same Redis as BullMQ. If Redis is unreachable the limits fail open (logged),
 * so an outage degrades protection instead of taking CV uploads down with it.
 */
@Injectable()
export class PublicCvLimitsService implements OnModuleDestroy {
  private readonly logger = new Logger(PublicCvLimitsService.name);
  private readonly redis: Redis;

  constructor(config: ConfigService) {
    const url =
      config.get<string>('REDIS_URL') ||
      config.get<string>('REDIS_PUBLIC_URL') ||
      config.get<string>('REDIS_PRIVATE_URL');
    // No offline queue: while Redis is down, commands fail fast (and the limits fail open)
    // instead of hanging the request.
    const options = { maxRetriesPerRequest: 1, enableOfflineQueue: false };
    this.redis = url
      ? new Redis(url, options)
      : new Redis({
          host: config.get<string>('REDIS_HOST') || 'localhost',
          port: Number(config.get<number>('REDIS_PORT')) || 6379,
          password: config.get<string>('REDIS_PASSWORD') || undefined,
          ...options,
        });
    this.redis.on('error', (e) => this.logger.warn(`Redis error: ${e.message}`));
  }

  async onModuleDestroy() {
    await this.redis.quit().catch(() => null);
  }

  /**
   * Fixed-window counter. Throws 429 (body carries `retryAfter` in seconds) once more than
   * `limit` hits land in `windowSec`.
   */
  async consume(key: string, limit: number, windowSec: number, message: string): Promise<void> {
    const redisKey = `public-cv:limit:${key}`;
    let count: number;
    try {
      count = await this.redis.incr(redisKey);
      if (count === 1) await this.redis.expire(redisKey, windowSec);
    } catch (e: any) {
      this.logger.warn(`Rate limit check skipped for ${key}: ${e.message}`);
      return;
    }

    if (count > limit) {
      const ttl = await this.redis.ttl(redisKey).catch(() => windowSec);
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, message, retryAfter: ttl > 0 ? ttl : windowSec },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Like consume(), but reports exhaustion instead of throwing (used for the AI budget). */
  async tryConsume(key: string, limit: number, windowSec: number): Promise<boolean> {
    try {
      await this.consume(key, limit, windowSec, '');
      return true;
    } catch (e) {
      if (e instanceof HttpException) return false;
      throw e;
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(`public-cv:cache:${key}`);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSec: number): Promise<void> {
    await this.redis.set(`public-cv:cache:${key}`, JSON.stringify(value), 'EX', ttlSec).catch(() => null);
  }
}
