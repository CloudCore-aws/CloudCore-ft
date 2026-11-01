import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { fileRoutes } from './routes/files.js';

const app = Fastify({ logger: true });

await app.register(cors, { origin: process.env.CLIENT_ORIGIN });
await app.register(multipart, {
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
});
await app.register(fileRoutes, { prefix: '/api' });

app.get('/health', async () => ({ ok: true }));

await app.listen({ port: Number(process.env.PORT ?? 4000), host: '0.0.0.0' });