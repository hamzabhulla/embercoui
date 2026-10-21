import { assertImageUpload, type StorageService } from '../src/lib/storage';

export class FakeStorageService implements StorageService {
  uploads: { filename: string; contentType: string; size: number }[] = [];
  async uploadMenuImage(input: { filename: string; contentType: string; data: Buffer }) {
    assertImageUpload(input.contentType, input.data.byteLength);
    this.uploads.push({ filename: input.filename, contentType: input.contentType, size: input.data.byteLength });
    return { publicUrl: `https://storage.example/menu-images/${input.filename}` };
  }
}
