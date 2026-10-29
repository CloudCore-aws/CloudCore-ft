import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { redis } from './lib/redis.js';
import { fileRoutes } from './routes/files.js';
import { vaultRoutes } from './routes/vault.js';

const app = Fastify({ logger: true });

await app.register(cors, { origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173' });
await app.register(multipart, {
  // One file, max 100MB; busboy enforces this while streaming, so oversized
  // uploads are cut off instead of being buffered in memory
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
});
// Off by default; routes opt in via config.rateLimit (see unlock)
await app.register(rateLimit, { global: false, redis });
await app.register(fileRoutes, { prefix: '/api' });
await app.register(vaultRoutes, { prefix: '/api' });

const port = Number(process.env.PORT ?? 4000);
await app.listen({ port, host: '0.0.0.0' });
