import { Injectable, Logger } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseStorageService {
  private supabase: SupabaseClient;
  private bucket: string;
  private readonly logger = new Logger(SupabaseStorageService.name);

  constructor() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const bucket = process.env.SUPABASE_BUCKET;

    if (!url) throw new Error('SUPABASE_URL is not defined');
    if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not defined');
    if (!bucket) throw new Error('SUPABASE_BUCKET is not defined');

    this.supabase = createClient(url, key);
    this.bucket = bucket;
  }

  async uploadFile(
    fileBuffer: Buffer,
    destination: string,
    mimeType: string,
  ): Promise<string> {
    const { error } = await this.supabase.storage
      .from(this.bucket)
      .upload(destination, fileBuffer, {
        contentType: mimeType,
        upsert: true,
      });

    if (error) throw new Error(`Supabase upload failed: ${error.message}`);

    const { data } = this.supabase.storage
      .from(this.bucket)
      .getPublicUrl(destination);

    return data.publicUrl;
  }
async downloadFile(path: string): Promise<Buffer> {
  console.log('Bucket:', this.bucket);
  console.log('File path:', path);

  const { data, error } = await this.supabase.storage
    .from(this.bucket)
    .download(path);

  if (error) throw new Error(`Download failed: ${error.message}`);

  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
  async deleteFile(storagePath: string): Promise<void> {
    const { error } = await this.supabase.storage
      .from(this.bucket)
      .remove([storagePath]);

    if (error) {
      this.logger.warn(`Could not delete Supabase file: ${storagePath}`);
    }
  }
}