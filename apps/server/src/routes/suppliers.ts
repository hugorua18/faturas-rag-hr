import { Router } from 'express';
import { prisma } from '../db/prisma';
import { lookupNifNameViaVies } from '../services/nif-lookup.service';

export const suppliersRouter = Router();

// GET /suppliers/lookup?nif=123456789 → { name, source }
// Resolve o nome do prestador a partir do NIF, por ordem de preferência:
//   1. "history": o nome que o próprio utilizador deu a este NIF na despesa
//      mais recente — reflete como ele conhece o fornecedor (ex: "O Manel"
//      em vez da denominação social completa) e não depende de rede externa.
//   2. "vies": registo oficial de IVA da UE (nome legal), best-effort.
// Devolve { name: null, source: null } quando nenhuma fonte conhece o NIF —
// nunca é um erro, o campo fica simplesmente por preencher manualmente.
suppliersRouter.get('/lookup', async (req, res) => {
  const nif = String(req.query.nif ?? '').trim();
  if (!/^\d{9}$/.test(nif)) {
    res.status(400).json({ error: 'NIF inválido — esperado 9 dígitos' });
    return;
  }

  const previous = await prisma.expense.findFirst({
    where: {
      userId: req.user!.id,
      supplierNif: nif,
      AND: [{ supplierName: { not: null } }, { supplierName: { not: '' } }],
    },
    orderBy: { updatedAt: 'desc' },
    select: { supplierName: true },
  });
  if (previous?.supplierName) {
    res.json({ name: previous.supplierName, source: 'history' });
    return;
  }

  try {
    const name = await lookupNifNameViaVies(nif);
    res.json(name ? { name, source: 'vies' } : { name: null, source: null });
  } catch {
    // VIES em baixo/timeout: o autofill é uma conveniência, não uma falha.
    res.json({ name: null, source: null });
  }
});
