import { LocalDiskStorage } from './local.js';
import type { StorageDriver } from './types.js';

export * from './types.js';
export * from './local.js';

export const storage: StorageDriver = new LocalDiskStorage();
