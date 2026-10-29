import type { FastifyInstance } from 'fastify';
import type { Multipart } from '@fastify/multipart';
import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import argon2 from 'argon2';
import { prisma } from '../lib/prisma.js';
import { storage } from '../storage/index.js';
import { newToken } from '../lib/tokens.js';

const EXPIRY_MS: Record<string, number> = {
  '10m': 10 * 60_000,
  '1h': 60 * 60_000,
  '24h': 24 * 60 * 60_000,
};
const CAPS = [1, 3, 10];

// Read a plain text field that arrived before the file part
function field(fields: Record<string, Multipart | Multipart[] | undefined>, name: string) {
  const p = fields[name];
  return p && !Array.isArray(p) && p.type === 'field' ? String(p.value) : undefined;
}

export async function fileRoutes(app: FastifyInstance) {
  app.post('/files', async (req, reply) => {
    const part = await req.file();
    if (!part) return reply.code(400).send({ error: 'No file uploaded' });

    // Fields sent BEFORE the file in the form are available here
    const expiry = field(part.fields, 'expiry') ?? '';
    const maxDownloads = Number(field(part.fields, 'maxDownloads'));
    const passkey = field(part.fields, 'passkey') || undefined;

    if (!Object.hasOwn(EXPIRY_MS, expiry) || !CAPS.includes(maxDownloads)) {
      part.file.resume(); // drain the stream
      return reply.code(400).send({ error: 'Invalid expiry or download cap' });
    }

    // Count bytes as they stream through, so the size never comes from the client
    let sizeBytes = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        sizeBytes += chunk.length;
        cb(null, chunk);
      },
    });
    part.file.on('error', (err) => counter.destroy(err)).pipe(counter);

    const storageKey = randomUUID();
    try {
      await storage.put(storageKey, counter);
    } catch (err) {
      await storage.delete(storageKey); // don't leave half-written files behind
      throw err;
    }

    // Busboy stops at the fileSize limit and marks the stream truncated
    if (part.file.truncated) {
      await storage.delete(storageKey);
      return reply.code(413).send({ error: 'File exceeds 100MB' });
    }

    const shareToken = newToken();
    const expiresAt = new Date(Date.now() + EXPIRY_MS[expiry]);

    try {
      await prisma.file.create({
        data: {
          shareToken,
          originalName: part.filename,
          mimeType: part.mimetype || 'application/octet-stream',
          sizeBytes,
          storageKey,
          passkeyHash: passkey ? await argon2.hash(passkey) : null,
          maxDownloads,
          downloadsRemaining: maxDownloads,
          expiresAt,
        },
      });
    } catch (err) {
      // No DB row means the cleanup worker would never find this file, so remove it now
      await storage.delete(storageKey);
      throw err;
    }

    return reply.code(201).send({ shareToken, expiresAt });
  });
}
