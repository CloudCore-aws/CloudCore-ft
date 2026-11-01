import cron from 'node-cron';
import { prisma } from '../lib/prisma.js';
import { storage } from '../storage/index.js';

export async function purgeExpired() {
  // Files that are expired OR used up, and not already cleaned
  const dead = await prisma.file.findMany({
    where: {
      deletedAt: null,
      OR: [{ expiresAt: { lt: new Date() } }, { downloadsRemaining: { lte: 0 } }],
    },
  });

  for (const f of dead) {
    await storage.delete(f.storageKey); // remove the bytes from disk
    await prisma.file.update({
      where: { id: f.id },
      data: { deletedAt: new Date() },  // mark the record as deleted
    });
  }

  if (dead.length) console.log(`[cleanup] purged ${dead.length} file(s)`);
}

export function startCleanupWorker() {
  purgeExpired().catch(console.error);                              // once on startup
  cron.schedule('*/5 * * * *', () => purgeExpired().catch(console.error)); // then every 5 min
}