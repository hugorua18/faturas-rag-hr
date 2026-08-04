import { Router } from 'express';
import { prisma } from '../db/prisma';
import { lookupNifNameViaVies } from '../services/nif-lookup.service';

export const suppliersRouter = Router();

// GET /suppliers/backfill → [{ nif, name, lastType }]
// Deriva, a partir do histórico de despesas já submetidas, um NIF→nome+última
// categoria por prestador — usado pela app para popular de uma vez o cache
// local de fornecedores (state/supplier-cache.ts) num utilizador que já tem
// faturas carregadas mas nunca as viu passar pelo autofill (ex: reinstalação
// da app, ou faturas anteriores a esta funcionalidade existir). Não é uma
// operação de escrita — só lê o que já está na BD.
suppliersRouter.get('/backfill', async (req, res) => {
  const expenses = await prisma.expense.findMany({
    where: {
      userId: req.user!.id,
      supplierNif: { not: null },
      supplierName: { not: null },
    },
    select: { supplierNif: true, supplierName: true, type: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
  });

  const byNif = new Map<string, { nif: string; name: string; lastType: string | null }>();
  for (const expense of expenses) {
    const nif = expense.supplierNif!;
    const name = expense.supplierName!;
    if (!/^\d{9}$/.test(nif) || !name.trim() || byNif.has(nif)) continue;
    // A lista já vem ordenada por updatedAt desc — a primeira despesa vista
    // para cada NIF é sempre a mais recente, exatamente a mesma regra usada
    // no autofill ao vivo ("guarda-se sempre a mais recente").
    byNif.set(nif, { nif, name: name.trim(), lastType: expense.type || null });
  }

  res.json(Array.from(byNif.values()));
});

// GET /suppliers/lookup?nif=123456789 → { name, source }
// Resolve o nome do prestador a partir do NIF, por ordem de preferência:
//   1. "history": o nome que o próprio utilizador deu a este NIF na despesa
//      mais recente — reflete como ele conhece o fornecedor (ex: "O Manel"
//      em vez da denominação social completa) e não depende de rede externa.
//   2. "vies": registo oficial de IVA da UE (nome legal), best-effort.
// Devolve { name: null, source: null } quando nenhuma fonte conhece o NIF —
// nunca é um erro, o campo fica simplesmente por preencher manualmente.
suppliersRouter.get('/lookup', async (req, res) => {
  const started = Date.now();
  const nif = String(req.query.nif ?? '').trim();
  if (!/^\d{9}$/.test(nif)) {
    res.status(400).json({ error: 'NIF inválido — esperado 9 dígitos' });
    return;
  }

  // Log de duração + fonte usada — o histórico devia ser sempre rápido (uma
  // query indexada); se aparecer lento aqui também, a causa é o pedido em si
  // (ex: servidor/BD "a acordar" no plano gratuito), não a lógica de escolha
  // histórico-vs-VIES.
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
    console.log(`[suppliers] lookup nif=${nif} source=history em ${Date.now() - started}ms`);
    res.json({ name: previous.supplierName, source: 'history' });
    return;
  }

  try {
    const name = await lookupNifNameViaVies(nif);
    console.log(
      `[suppliers] lookup nif=${nif} source=${name ? 'vies' : 'none'} em ${Date.now() - started}ms`,
    );
    res.json(name ? { name, source: 'vies' } : { name: null, source: null });
  } catch (err) {
    // VIES em baixo/timeout: o autofill é uma conveniência, não uma falha.
    console.log(`[suppliers] lookup nif=${nif} vies falhou em ${Date.now() - started}ms`, err);
    res.json({ name: null, source: null });
  }
});
