import type { Readable } from 'node:stream';

export interface StorageDriver {
  put(key: string, stream: NodeJS.ReadableStream | Readable): Promise<void>;
  get(key: string): NodeJS.ReadableStream | Readable;
  delete(key: string): Promise<void>;
}
