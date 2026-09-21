import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class R2StorageService {
  private readonly s3Client: S3Client;
  private readonly bucket: string;
  private readonly logger = new Logger(R2StorageService.name);

  constructor() {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const bucket = process.env.R2_BUCKET_NAME;

    if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
      this.logger.error('Cloudflare R2 configuration is missing in environment variables');
      throw new Error('Cloudflare R2 environment variables are not properly configured');
    }

    this.bucket = bucket;

    this.s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  /**
   * Upload a file buffer directly to Cloudflare R2
   */
  async uploadFile(
    fileBuffer: Buffer,
    key: string,
    mimeType: string,
  ): Promise<string> {
    try {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: fileBuffer,
          ContentType: mimeType,
        }),
      );

      return key;
    } catch (error: any) {
      this.logger.error(`Failed to upload file to Cloudflare R2: ${error.message}`);
      throw error;
    }
  }

  /**
   * Download a file buffer from Cloudflare R2
   */
  async downloadFile(key: string): Promise<Buffer> {
    try {
      const response = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );

      if (!response.Body) {
        throw new Error(`File ${key} not found or empty`);
      }

      // AWS SDK v3 stream to byte array
      const byteArray = await response.Body.transformToByteArray();
      return Buffer.from(byteArray);
    } catch (error: any) {
      this.logger.error(`Failed to download file from Cloudflare R2: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate a secure pre-signed download URL (valid for X seconds)
   */
  async getSignedDownloadUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      return await getSignedUrl(this.s3Client, command, { expiresIn: expiresInSeconds });
    } catch (error: any) {
      this.logger.error(`Failed to generate signed URL for ${key}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete a file from Cloudflare R2
   */
  async deleteFile(key: string): Promise<void> {
    try {
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
    } catch (error: any) {
      this.logger.warn(`Could not delete file from Cloudflare R2: ${key} — ${error.message}`);
    }
  }
}
