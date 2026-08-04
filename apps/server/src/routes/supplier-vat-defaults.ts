import { Router } from 'express';
import { prisma } from '../db/prisma';
import { asyncHandler } from '../utils/async-handler';

export const supplierVatDefaultsRouter = Router();

// GET /supplier-vat-defaults → { [supplierNif]: boolean }
// Valor de IVA dedutível aprendido por NIF de prestador — só é relevante
// quando User.vatAutoFillMode = "SUPPLIER" (ver services/vat-learning.service.ts).
supplierVatDefaultsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await prisma.supplierVatDefault.findMany({ where: { userId: req.user!.id } });
    const byNif: Record<string, boolean> = {};
    for (const row of rows) byNif[row.supplierNif] = row.vatDeductible;
    res.json(byNif);
  }),
);

// PUT /supplier-vat-defaults/:nif → define (ou remove, se vatDeductible vier
// null/omitido) o valor por omissão deste fornecedor. Idempotente.
supplierVatDefaultsRouter.put(
  '/:nif',
  asyncHandler(async (req, res) => {
    const nif = req.params.nif;
    const body = req.body as { vatDeductible?: unknown };
    const userId = req.user!.id;

    if (body.vatDeductible === null || body.vatDeductible === undefined) {
      await prisma.supplierVatDefault.deleteMany({ where: { userId, supplierNif: nif } });
      res.status(204).send();
      return;
    }
    if (typeof body.vatDeductible !== 'boolean') {
      res.status(400).json({ error: 'vatDeductible tem de ser true, false ou null' });
      return;
    }

    await prisma.supplierVatDefault.upsert({
      where: { userId_supplierNif: { userId, supplierNif: nif } },
      create: { userId, supplierNif: nif, vatDeductible: body.vatDeductible },
      update: { vatDeductible: body.vatDeductible },
    });
    res.status(204).send();
  }),
);
