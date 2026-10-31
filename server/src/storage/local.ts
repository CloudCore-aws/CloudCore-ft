import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { StorageDriver } from './types.js';

export class LocalDiskStorage implements StorageDriver {
  private baseDir: string;
  private dirReady: Promise<string | undefined>;

  constructor(baseDir?: string) {
    this.baseDir = path.resolve(baseDir ?? process.env.STORAGE_DIR ?? './uploads');
    this.dirReady = fs.mkdir(this.baseDir, { recursive: true });
  }

  private resolvePath(key: string): string {
    const safeKey = path.basename(key);
    const resolved = path.join(this.baseDir, safeKey);
    if (!resolved.startsWith(this.baseDir)) {
      throw new Error('Invalid storage key: directory traversal forbidden');
    }
    return resolved;
  }

  async put(key: string, stream: NodeJS.ReadableStream | Readable): Promise<void> {
    await this.dirReady;
    const filePath = this.resolvePath(key);
    const writeStream = createWriteStream(filePath);
    await pipeline(stream, writeStream);
  }

  get(key: string): NodeJS.ReadableStream {
    const filePath = this.resolvePath(key);
    return createReadStream(filePath);
  }

  async delete(key: string): Promise<void> {
    await this.dirReady;
    const filePath = this.resolvePath(key);
    try {
      await fs.unlink(filePath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
  }
}
