import { createClient } from '@supabase/supabase-js';
import { ApiError } from './errors';

export interface StorageService {
  uploadMenuImage(input: { filename: string; contentType: string; data: Buffer }): Promise<{ publicUrl: string }>;
}

const ALLOWED_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function assertImageUpload(contentType: string, byteLength: number) {
  if (!ALLOWED_TYPES[contentType]) {
    throw new ApiError(400, 'Please upload a PNG, JPEG, WebP or GIF image');
  }
  if (byteLength === 0) throw new ApiError(400, 'The uploaded file is empty');
  if (byteLength > MAX_IMAGE_BYTES) throw new ApiError(400, 'Image must be 5 MB or smaller');
}

export function createStorageService(url: string, serviceRoleKey: string): StorageService {
  const client = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  return {
    async uploadMenuImage({ filename, contentType, data }) {
      assertImageUpload(contentType, data.byteLength);
      const ext = ALLOWED_TYPES[contentType];
      const safeBase = filename.replace(/\.[^.]*$/, '').replace(/[^a-zA-Z0-9-_]+/g, '-').slice(0, 40) || 'dish';
      const path = `${Date.now()}-${safeBase}.${ext}`;
      const { error } = await client.storage.from('menu-images').upload(path, data, { contentType, upsert: false });
      if (error) throw new ApiError(500, `Image upload failed: ${error.message}`);
      const { data: pub } = client.storage.from('menu-images').getPublicUrl(path);
      return { publicUrl: pub.publicUrl };
    },
  };
}
