import { Injectable, Logger } from '@nestjs/common';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

/**
 * Writes to the public R2 bucket behind LOGO_BASE_URL (company logos only; CVs stay in the private bucket).
 * Uses the same R2 key as the CV storage. Disabled, not failing, when its variables are missing.
 */
@Injectable()
export class LogoStorageService {
  private readonly logger = new Logger(LogoStorageService.name);
  private readonly client: S3Client | null = null;
  private readonly bucket = process.env.R2_PUBLIC_BUCKET ?? '';
  private readonly baseUrl = (process.env.LOGO_BASE_URL ?? '').replace(/\/+$/, '');

  constructor() {
    const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !this.bucket || !this.baseUrl) {
      this.logger.warn('Company logos are off: R2_PUBLIC_BUCKET / LOGO_BASE_URL (or the R2 keys) are not set');
      return;
    }
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    });
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  /** Uploads a file that never changes under its name (the name holds a content hash); returns its public URL. */
  async putImmutable(key: string, body: Buffer, contentType: string): Promise<string> {
    if (!this.client) throw new Error('Logo storage is not configured');
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    return `${this.baseUrl}/${key}`;
  }
}
