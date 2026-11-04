import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { redis } from './lib/redis.js';
import { fileRoutes } from './routes/files.js';
import { vaultRoutes } from './routes/vault.js';
import { startCleanupWorker } from './workers/cleanup.js';

// trustProxy: 1 → trust ONLY the address added by the one proxy in front (CloudFront)
const app = Fastify({ logger: true, trustProxy: 1 });

await app.register(cors, { origin: process.env.CLIENT_ORIGIN });
await app.register(multipart, {
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
});
await app.register(rateLimit, { global: false, redis });

await app.register(fileRoutes, { prefix: '/api' });
await app.register(vaultRoutes, { prefix: '/api' });

app.get('/health', async () => ({ ok: true }));

startCleanupWorker();
await app.listen({ port: Number(process.env.PORT ?? 4000), host: '0.0.0.0' });