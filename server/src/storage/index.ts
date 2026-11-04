import { LocalDiskStorage } from './local.js';
import type { StorageDriver } from './types.js';
import { S3Storage } from './s3.js';

export * from './types.js';
export * from './local.js';


export const storage: StorageDriver =
  process.env.STORAGE_DRIVER === 's3' ? new S3Storage() : new LocalDiskStorage();
