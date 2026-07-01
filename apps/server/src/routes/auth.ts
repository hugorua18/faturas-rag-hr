import crypto from 'node:crypto';
import { Router } from 'express';
import { prisma } from '../db/prisma';
import { requireAuth } from '../middleware/require-auth';
import { encryptRefreshToken, exchangeAuthCodeForTokens, verifyGoogleIdToken } from '../services/google-auth.service';

export const authRouter = Router();

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Passo de login em si — não pode exigir sessão porque é aqui que a sessão nasce.
authRouter.post('/google/callback', async (req, res) => {
  const { code, redirectUri, codeVerifier, clientId } = req.body as {
    code?: string;
    redirectUri?: string;
    codeVerifier?: string;
    clientId?: string;
  };
  if (!code || !redirectUri) {
    res.status(400).json({ error: 'code e redirectUri são obrigatórios' });
    return;
  }

  try {
    const { idToken, refreshToken } = await exchangeAuthCodeForTokens(code, redirectUri, codeVerifier, clientId);
    const identity = await verifyGoogleIdToken(idToken);
    if (!identity.emailVerified) {
      res.status(401).json({ error: 'O email da conta Google não está verificado' });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { googleId: identity.sub } });
    // O Google só devolve refresh_token no primeiro consentimento — num
    // re-login normal não vem nenhum, e não podemos apagar um que já exista.
    const encryptedRefreshToken = refreshToken ? encryptRefreshToken(refreshToken) : undefined;

    const user = existing
      ? await prisma.user.update({
          where: { id: existing.id },
          data: {
            email: identity.email,
            ...(encryptedRefreshToken ? { googleRefreshTokenEnc: encryptedRefreshToken } : {}),
          },
        })
      : await prisma.user.create({
          data: {
            email: identity.email,
            googleId: identity.sub,
            googleRefreshTokenEnc: encryptedRefreshToken,
          },
        });

    const sessionToken = crypto.randomBytes(32).toString('hex');
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(sessionToken),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });

    res.json({ sessionToken, user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error('[auth] falha no login com Google', err);
    res.status(401).json({ error: 'Falha na autenticação com o Google' });
  }
});

authRouter.post('/logout', requireAuth, async (req, res) => {
  const authHeader = req.header('authorization') ?? req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : undefined;
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  res.status(204).send();
});

authRouter.get('/me', requireAuth, async (req, res) => {
  res.json({ id: req.user!.id, email: req.user!.email });
});
