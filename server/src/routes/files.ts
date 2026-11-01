import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
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

export async function fileRoutes(app: FastifyInstance) {
  app.post('/files', async (req, reply) => {
    const part = await req.file();
    if (!part) return reply.code(400).send({ error: 'No file uploaded' });

    // Fields sent BEFORE the file in the form are available here
    const f = part.fields as Record<string, any>;
    const expiry: string = f.expiry?.value;
    const maxDownloads = Number(f.maxDownloads?.value);
    const passkey: string | undefined = f.passkey?.value || undefined;

    if (!EXPIRY_MS[expiry] || !CAPS.includes(maxDownloads)) {
      part.file.resume(); // drain the stream
      return reply.code(400).send({ error: 'Invalid expiry or download cap' });
    }

    const storageKey = randomUUID();
    await storage.put(storageKey, part.file);

    if (part.file.truncated) {
      await storage.delete(storageKey);
      return reply.code(413).send({ error: 'File exceeds 100MB' });
    }

    const shareToken = newToken();
    const expiresAt = new Date(Date.now() + EXPIRY_MS[expiry]);

    await prisma.file.create({
      data: {
        shareToken,
        originalName: part.filename,
        mimeType: part.mimetype || 'application/octet-stream',
        sizeBytes: part.file.bytesRead,
        storageKey,
        passkeyHash: passkey ? await argon2.hash(passkey) : null,
        maxDownloads,
        downloadsRemaining: maxDownloads,
        expiresAt,
      },
    });

    return { shareToken, expiresAt };
  });
}