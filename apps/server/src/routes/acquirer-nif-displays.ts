import { Router } from 'express';
import { prisma } from '../db/prisma';

export const acquirerNifDisplaysRouter = Router();

// GET /acquirer-nif-displays → { [acquirerNif]: { label, icon } }
// Etiqueta + ícone personalizados por NIF de adquirente, guardados no
// servidor (não no dispositivo) para sincronizar entre iOS e Web.
acquirerNifDisplaysRouter.get('/', async (req, res) => {
  const rows = await prisma.acquirerNifDisplay.findMany({ where: { userId: req.user!.id } });
  const byNif: Record<string, { label: string | null; icon: string | null }> = {};
  for (const row of rows) {
    byNif[row.acquirerNif] = { label: row.label, icon: row.icon };
  }
  res.json(byNif);
});

// PUT /acquirer-nif-displays/:nif → define (ou limpa, se ambos vazios) a
// etiqueta/ícone deste NIF. Idempotente — cria ou atualiza.
acquirerNifDisplaysRouter.put('/:nif', async (req, res) => {
  const nif = req.params.nif;
  const body = req.body as { label?: unknown; icon?: unknown };
  const label = typeof body.label === 'string' ? body.label.trim() : null;
  const icon = typeof body.icon === 'string' ? body.icon.trim() : null;
  const userId = req.user!.id;

  if (!label && !icon) {
    await prisma.acquirerNifDisplay.deleteMany({ where: { userId, acquirerNif: nif } });
    res.status(204).send();
    return;
  }

  await prisma.acquirerNifDisplay.upsert({
    where: { userId_acquirerNif: { userId, acquirerNif: nif } },
    create: { userId, acquirerNif: nif, label: label || null, icon: icon || null },
    update: { label: label || null, icon: icon || null },
  });
  res.status(204).send();
});
