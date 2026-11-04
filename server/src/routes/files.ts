import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { prisma } from '../lib/prisma.js';
import { storage } from '../storage/index.js';
import { newToken } from '../lib/tokens.js';
import { presignPut, objectSize } from '../storage/s3.js'; // NEW (AWS helpers)

const EXPIRY_MS: Record<string, number> = {
  '10m': 10 * 60_000,
  '1h': 60 * 60_000,
  '24h': 24 * 60 * 60_000,
};
const CAPS = [1, 3, 10];
const MAX_BYTES = 100 * 1024 * 1024; // NEW (used by the AWS routes)

export async function fileRoutes(app: FastifyInstance) {
  // ─────────────────────────────────────────────────────────────
  // LOCAL MODE: file comes through the server (used by `pnpm dev`)
  // ─────────────────────────────────────────────────────────────
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
    try {
      await storage.put(storageKey, part.file);
    } catch (err) {
      await storage.delete(storageKey); // don't leave a partial file behind
      throw err;                        // Fastify turns the size-limit error into HTTP 413
    }

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
        uploadedAt: new Date(), // NEW: the file is already fully saved at this point
      },
    });

    return { shareToken, expiresAt };
  });

  // ─────────────────────────────────────────────────────────────
  // AWS MODE, step 1: create the record + pre-signed S3 upload URL
  // ─────────────────────────────────────────────────────────────
  app.post('/files/init', async (req, reply) => {
    const b = (req.body ?? {}) as {
      fileName?: string; mimeType?: string; sizeBytes?: number;
      expiry?: string; maxDownloads?: number; passkey?: string;
    };
    const maxDownloads = Number(b.maxDownloads);

    if (!b.fileName || !b.expiry || !EXPIRY_MS[b.expiry] || !CAPS.includes(maxDownloads)) {
      return reply.code(400).send({ error: 'Invalid expiry or download cap' });
    }
    if (!b.sizeBytes || b.sizeBytes > MAX_BYTES) {
      return reply.code(413).send({ error: 'File exceeds 100MB' });
    }

    const mimeType = b.mimeType || 'application/octet-stream';
    const storageKey = randomUUID();

    const record = await prisma.file.create({
      data: {
        shareToken: newToken(),
        originalName: b.fileName,
        mimeType,
        sizeBytes: b.sizeBytes,
        storageKey,
        passkeyHash: b.passkey ? await argon2.hash(b.passkey) : null,
        maxDownloads,
        downloadsRemaining: maxDownloads,
        expiresAt: new Date(Date.now() + EXPIRY_MS[b.expiry]),
        uploadedAt: null, // invisible until /complete confirms the upload
      },
    });

    return { fileId: record.id, uploadUrl: await presignPut(storageKey, mimeType) };
  });

  // ─────────────────────────────────────────────────────────────
  // AWS MODE, step 2: confirm the upload arrived and is within limit
  // ─────────────────────────────────────────────────────────────
  app.post('/files/:id/complete', async (req, reply) => {
    const { id } = req.params as { id: string };

    const file = await prisma.file.findFirst({
      where: { id, uploadedAt: null, deletedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!file) return reply.code(404).send({ error: 'Upload not found' });

    const size = await objectSize(file.storageKey);
    if (size === null) return reply.code(400).send({ error: 'File was not uploaded' });

    if (size > MAX_BYTES) {
      // A pre-signed PUT can't enforce size itself, so check here and throw it away
      await storage.delete(file.storageKey);
      await prisma.file.update({ where: { id }, data: { deletedAt: new Date() } });
      return reply.code(413).send({ error: 'File exceeds 100MB' });
    }

    await prisma.file.update({
      where: { id },
      data: { uploadedAt: new Date(), sizeBytes: size },
    });

    return { shareToken: file.shareToken, expiresAt: file.expiresAt };
  });
}