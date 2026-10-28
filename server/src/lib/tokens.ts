import { randomBytes } from 'node:crypto';

// 32 random bytes = 256 bits: impossible to guess or enumerate
export const newToken = (bytes = 32) => randomBytes(bytes).toString('base64url');