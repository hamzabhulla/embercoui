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

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// The declared content type is only a claim — verify the bytes actually
// are the format they claim to be, so a renamed text/executable file
// cannot land in the public bucket wearing an image extension.
function matchesDeclaredType(contentType: string, data: Buffer): boolean {
  switch (contentType) {
    case 'image/jpeg':
      return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
    case 'image/png':
      return data.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((b, i) => data[i] === b);
    case 'image/webp':
      return data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
    case 'image/gif': {
      if (data.length < 6) return false;
      const head = data.toString('ascii', 0, 6);
      return head === 'GIF87a' || head === 'GIF89a';
    }
    default:
      return false;
  }
}

export function assertImageUpload(contentType: string, data: Buffer) {
  if (!ALLOWED_TYPES[contentType]) {
    throw new ApiError(400, 'Please upload a PNG, JPEG, WebP or GIF image');
  }
  if (data.byteLength === 0) throw new ApiError(400, 'The uploaded file is empty');
  if (data.byteLength > MAX_IMAGE_BYTES) throw new ApiError(400, 'Image must be 5 MB or smaller');
  if (!matchesDeclaredType(contentType, data)) {
    throw new ApiError(400, 'The file content does not match its image type — please upload a genuine PNG, JPEG, WebP or GIF image');
  }
}

export function createStorageService(url: string, serviceRoleKey: string): StorageService {
  const client = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  return {
    async uploadMenuImage({ filename, contentType, data }) {
      assertImageUpload(contentType, data);
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
