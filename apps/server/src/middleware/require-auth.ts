import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../db/prisma';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Gate de sessão da app (Google Sign-In do utilizador final) — lê o token opaco
// do header Authorization, confirma que a sessão existe e não expirou, e anexa
// o utilizador a req.user para os handlers seguintes usarem em todos os filtros.
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.header('authorization') ?? req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : undefined;

  if (!token) {
    res.status(401).json({ error: 'Sessão em falta' });
    return;
  }

  const tokenHash = hashToken(token);
  const session = await prisma.session.findUnique({ where: { tokenHash }, include: { user: true } });

  if (!session || session.expiresAt.getTime() <= Date.now()) {
    res.status(401).json({ error: 'Sessão inválida ou expirada' });
    return;
  }

  req.user = session.user;
  next();
}
