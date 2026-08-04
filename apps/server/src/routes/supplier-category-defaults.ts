import { Router } from 'express';
import { prisma } from '../db/prisma';
import { isValidCategoryKey } from '../services/expense-categories.service';
import { asyncHandler } from '../utils/async-handler';

export const supplierCategoryDefaultsRouter = Router();

// GET /supplier-category-defaults → { [supplierNif]: categoryKey }
// Categoria por omissão por NIF de prestador — pré-preenche o ecrã de
// validação/edição (sempre alterável fatura a fatura, ver validation.tsx).
supplierCategoryDefaultsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await prisma.supplierCategoryDefault.findMany({ where: { userId: req.user!.id } });
    const byNif: Record<string, string> = {};
    for (const row of rows) byNif[row.supplierNif] = row.categoryKey;
    res.json(byNif);
  }),
);

// PUT /supplier-category-defaults/:nif → define (ou remove, se categoryKey vier
// null/omitido) a categoria por omissão deste fornecedor. Idempotente.
supplierCategoryDefaultsRouter.put(
  '/:nif',
  asyncHandler(async (req, res) => {
    const nif = req.params.nif;
    const body = req.body as { categoryKey?: unknown };
    const userId = req.user!.id;

    if (body.categoryKey === null || body.categoryKey === undefined) {
      await prisma.supplierCategoryDefault.deleteMany({ where: { userId, supplierNif: nif } });
      res.status(204).send();
      return;
    }
    if (typeof body.categoryKey !== 'string' || !(await isValidCategoryKey(userId, body.categoryKey))) {
      res.status(400).json({ error: 'Categoria inválida' });
      return;
    }

    await prisma.supplierCategoryDefault.upsert({
      where: { userId_supplierNif: { userId, supplierNif: nif } },
      create: { userId, supplierNif: nif, categoryKey: body.categoryKey },
      update: { categoryKey: body.categoryKey },
    });
    res.status(204).send();
  }),
);
