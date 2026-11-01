import type { FastifyInstance } from 'fastify';
import argon2 from 'argon2';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import { storage } from '../storage/index.js';
import { newToken } from '../lib/tokens.js';

// A file is usable only if: not deleted, not expired, downloads remain
const findActive = (shareToken: string) =>
  prisma.file.findFirst({
    where: {
      shareToken,
      deletedAt: null,
      expiresAt: { gt: new Date() },
      downloadsRemaining: { gt: 0 },
    },
  });
// Creates a one-time download ticket valid for 60 seconds
async function issueTicket(fileId: string) {
  const ticket = newToken(24);
  await redis.set(`ticket:${ticket}`, fileId, 'EX', 60);
  return ticket;
} 
export async function vaultRoutes(app: FastifyInstance) {
  // 1. STATUS — only says whether a password is needed. No name, no size.
  app.get('/vault/:token/status', async (req, reply) => {
    const { token } = req.params as { token: string };
    const file = await findActive(token);
    if (!file) return reply.code(404).send({ error: 'Link expired or invalid' });
    return { requiresPassword: !!file.passkeyHash };
  });

  // 2. UNLOCK — max 5 attempts per IP per link every 15 minutes
  app.post(
    '/vault/:token/unlock',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '15 minutes',
          keyGenerator: (req) => `${req.ip}:${(req.params as any).token}`,
        },
      },
    },
    async (req, reply) => {
      const { token } = req.params as { token: string };
      const { passkey } = (req.body ?? {}) as { passkey?: string };

      const file = await findActive(token);
      if (!file) return reply.code(404).send({ error: 'Link expired or invalid' });

      if (file.passkeyHash) {
        const ok = !!passkey && (await argon2.verify(file.passkeyHash, passkey));
        await prisma.accessLog.create({
          data: { fileId: file.id, ip: req.ip, action: ok ? 'UNLOCK_OK' : 'UNLOCK_FAIL' },
        });
        if (!ok) return reply.code(401).send({ error: 'Wrong passkey' });
      }

      // Unlock session: lets the page get fresh tickets for 15 min without the passkey
      const unlockSession = newToken(24);
      await redis.set(`session:${unlockSession}`, file.id, 'EX', 15 * 60);

      return {
        fileName: file.originalName,
        sizeBytes: file.sizeBytes,
        expiresAt: file.expiresAt,
        downloadsRemaining: file.downloadsRemaining,
        downloadTicket: await issueTicket(file.id),
        unlockSession,
      };
    }
  );
  // 2b. TICKET — fresh download ticket using the unlock session (no passkey needed)
  app.post(
    '/vault/:token/ticket',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '15 minutes',
          keyGenerator: (req) => `ticket:${req.ip}:${(req.params as any).token}`,
        },
      },
    },
    async (req, reply) => {
      const { token } = req.params as { token: string };
      const { unlockSession } = (req.body ?? {}) as { unlockSession?: string };
      if (!unlockSession) return reply.code(400).send({ error: 'Missing unlock session' });

      const sessionFileId = await redis.get(`session:${unlockSession}`);
      const file = await findActive(token);

      // Session must exist AND belong to this exact link
      if (!sessionFileId || !file || file.id !== sessionFileId) {
        return reply.code(403).send({ error: 'Session expired, please unlock again' });
      }

      return {
        downloadTicket: await issueTicket(file.id),
        downloadsRemaining: file.downloadsRemaining,
      };
    }
  );
  // 3. DOWNLOAD — single-use ticket + atomic decrement
  app.get('/vault/:token/download', async (req, reply) => {
    const { ticket } = req.query as { ticket?: string };
    if (!ticket) return reply.code(400).send({ error: 'Missing ticket' });

    // GETDEL reads and deletes in one step → a ticket works only once
    const fileId = await redis.getdel(`ticket:${ticket}`);
    if (!fileId) return reply.code(403).send({ error: 'Ticket invalid or expired' });

    // THE RACE-CONDITION FIX: check and decrement in ONE statement
    const { count } = await prisma.file.updateMany({
      where: {
        id: fileId,
        downloadsRemaining: { gt: 0 },
        expiresAt: { gt: new Date() },
        deletedAt: null,
      },
      data: { downloadsRemaining: { decrement: 1 } },
    });
    if (count === 0) {
      return reply.code(410).send({ error: 'Download limit reached or link expired' });
    }

    const file = await prisma.file.findUniqueOrThrow({ where: { id: fileId } });
    await prisma.accessLog.create({ data: { fileId, ip: req.ip, action: 'DOWNLOAD' } });

    reply
      .header('Content-Type', file.mimeType)
      .header('Content-Length', file.sizeBytes)
      .header('X-Content-Type-Options', 'nosniff')
      .header(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`
      );
    return reply.send(storage.get(file.storageKey)); // teammate's method name
  });
}