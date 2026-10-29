import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import argon2 from 'argon2';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import { storage } from '../storage/index.js';
import { newToken } from '../lib/tokens.js';

const TICKET_TTL_S = 60;

type TokenParams = { Params: { token: string } };

// Look up a vault by share token. Missing and already-deleted vaults get the same 404
// so the response never says "this existed once".
async function findVault(token: string, reply: FastifyReply) {
  const file = await prisma.file.findUnique({ where: { shareToken: token } });
  if (!file || file.deletedAt) {
    reply.code(404).send({ error: 'Vault not found' });
    return null;
  }
  if (file.expiresAt <= new Date() || file.downloadsRemaining <= 0) {
    reply.code(410).send({ error: 'Vault has expired or reached its download limit' });
    return null;
  }
  return file;
}

// Keep the original name for the browser, but strip anything that could break the header
function contentDisposition(name: string) {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function vaultRoutes(app: FastifyInstance) {
  // Only tells the client whether to show a passkey box: no name, size or type
  // until the vault is unlocked
  app.get<TokenParams>('/vault/:token/status', async (req, reply) => {
    const file = await findVault(req.params.token, reply);
    if (!file) return;
    return { requiresPassword: file.passkeyHash !== null };
  });

  app.post<TokenParams & { Body: { passkey?: unknown } | undefined }>(
    '/vault/:token/unlock',
    {
      config: {
        // Brute-force guard: 5 attempts per IP per vault every 15 minutes, counted in
        // Redis so the limit survives restarts and is shared between server instances
        rateLimit: {
          max: 5,
          timeWindow: '15 minutes',
          keyGenerator: (req: FastifyRequest) =>
            `unlock:${req.ip}:${(req.params as { token: string }).token}`,
        },
      },
    },
    async (req, reply) => {
      const file = await findVault(req.params.token, reply);
      if (!file) return;

      if (file.passkeyHash) {
        const passkey = req.body?.passkey;
        const ok = typeof passkey === 'string' && (await argon2.verify(file.passkeyHash, passkey));
        if (!ok) {
          await prisma.accessLog.create({ data: { fileId: file.id, ip: req.ip, action: 'UNLOCK_FAIL' } });
          return reply.code(401).send({ error: 'Wrong passkey' });
        }
      }
      await prisma.accessLog.create({ data: { fileId: file.id, ip: req.ip, action: 'UNLOCK_OK' } });

      // Short-lived, single-use ticket: the download link never carries the passkey,
      // and a leaked link is useless after one use or 60 seconds
      const ticket = newToken();
      await redis.set(`ticket:${ticket}`, file.id, 'EX', TICKET_TTL_S);

      return {
        originalName: file.originalName,
        sizeBytes: file.sizeBytes,
        mimeType: file.mimeType,
        expiresAt: file.expiresAt,
        downloadsRemaining: file.downloadsRemaining,
        ticket,
      };
    },
  );

  app.get<TokenParams & { Querystring: { ticket?: string } }>(
    '/vault/:token/download',
    async (req, reply) => {
      const { ticket } = req.query;
      // GETDEL reads and deletes in one step, so two requests can never both use a ticket
      const fileId = typeof ticket === 'string' ? await redis.getdel(`ticket:${ticket}`) : null;
      if (!fileId) return reply.code(403).send({ error: 'Invalid or expired ticket' });

      const file = await findVault(req.params.token, reply);
      if (!file) return;
      if (file.id !== fileId) return reply.code(403).send({ error: 'Invalid or expired ticket' });

      // Atomic check-and-decrement in a single UPDATE ... WHERE downloadsRemaining > 0.
      // Reading the count and then writing it would let parallel requests both pass the check.
      const { count } = await prisma.file.updateMany({
        where: {
          id: file.id,
          deletedAt: null,
          expiresAt: { gt: new Date() },
          downloadsRemaining: { gt: 0 },
        },
        data: { downloadsRemaining: { decrement: 1 } },
      });
      if (count === 0) {
        return reply.code(410).send({ error: 'Vault has expired or reached its download limit' });
      }
      await prisma.accessLog.create({ data: { fileId: file.id, ip: req.ip, action: 'DOWNLOAD' } });

      return reply
        .header('Content-Type', file.mimeType)
        .header('Content-Length', file.sizeBytes)
        // attachment + nosniff: the browser saves the file instead of rendering it, so an
        // uploaded .html file can't run scripts on our origin
        .header('Content-Disposition', contentDisposition(file.originalName))
        .header('X-Content-Type-Options', 'nosniff')
        .header('Cache-Control', 'no-store')
        .send(storage.get(file.storageKey));
    },
  );
}
