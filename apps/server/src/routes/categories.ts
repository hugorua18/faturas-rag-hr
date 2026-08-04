import { Router } from 'express';
import type { ExpenseCategory as ExpenseCategoryDto } from '@invoice-scanner/shared';
import type { ExpenseCategory } from '@prisma/client';
import { prisma } from '../db/prisma';
import { categoryUsageCounts, ensureUserCategories, generateUniqueCategoryKey } from '../services/expense-categories.service';

export const categoriesRouter = Router();

function toDto(category: ExpenseCategory, expenseCount = 0): ExpenseCategoryDto {
  return {
    id: category.id,
    key: category.key,
    label: category.label,
    vatDeductible: category.vatDeductible,
    sortOrder: category.sortOrder,
    expenseCount,
  };
}

// GET /categories → lista de categorias do utilizador (semeia a partir dos
// EXPENSE_TYPES fixos na primeira vez, ver ensureUserCategories). expenseCount
// vem sempre incluído — o cliente usa-o para avisar antes de eliminar/alterar
// uma categoria já usada em faturas, sem precisar de um pedido extra.
categoriesRouter.get('/', async (req, res) => {
  const userId = req.user!.id;
  const [categories, usage] = await Promise.all([ensureUserCategories(userId), categoryUsageCounts(userId)]);
  res.json(categories.map((category) => toDto(category, usage.get(category.key) ?? 0)));
});

// POST /categories → cria uma categoria nova, própria do utilizador.
categoriesRouter.post('/', async (req, res) => {
  const body = req.body as { label?: unknown; vatDeductible?: unknown };
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  if (!label) {
    res.status(400).json({ error: 'Nome da categoria é obrigatório' });
    return;
  }
  if (body.vatDeductible !== undefined && body.vatDeductible !== null && typeof body.vatDeductible !== 'boolean') {
    res.status(400).json({ error: 'vatDeductible tem de ser true, false ou null' });
    return;
  }

  const userId = req.user!.id;
  await ensureUserCategories(userId); // garante que já existem categorias seed antes de calcular sortOrder
  const key = await generateUniqueCategoryKey(userId, label);
  const maxSortOrder = await prisma.expenseCategory.aggregate({ where: { userId }, _max: { sortOrder: true } });

  const category = await prisma.expenseCategory.create({
    data: {
      userId,
      key,
      label,
      vatDeductible: (body.vatDeductible as boolean | null | undefined) ?? null,
      sortOrder: (maxSortOrder._max.sortOrder ?? -1) + 1,
    },
  });
  res.status(201).json(toDto(category));
});

// PATCH /categories/:id → renomear e/ou (des)classificar IVA dedutível. O
// `key` nunca muda — é a referência estável guardada em Expense.type.
categoriesRouter.patch('/:id', async (req, res) => {
  const body = req.body as { label?: unknown; vatDeductible?: unknown };
  const data: { label?: string; vatDeductible?: boolean | null } = {};

  if (body.label !== undefined) {
    const label = typeof body.label === 'string' ? body.label.trim() : '';
    if (!label) {
      res.status(400).json({ error: 'Nome da categoria é obrigatório' });
      return;
    }
    data.label = label;
  }
  if (body.vatDeductible !== undefined) {
    if (body.vatDeductible !== null && typeof body.vatDeductible !== 'boolean') {
      res.status(400).json({ error: 'vatDeductible tem de ser true, false ou null' });
      return;
    }
    data.vatDeductible = body.vatDeductible as boolean | null;
  }

  const existing = await prisma.expenseCategory.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
  if (!existing) {
    res.status(404).json({ error: 'Categoria não encontrada' });
    return;
  }
  const category = await prisma.expenseCategory.update({ where: { id: existing.id }, data });
  const expenseCount = await prisma.expense.count({ where: { userId: req.user!.id, type: category.key } });
  res.json(toDto(category, expenseCount));
});

// DELETE /categories/:id → despesas antigas com este `type` mantêm o valor
// (string solta, sem FK) e passam a mostrar a chave em bruto — mesmo
// comportamento que já existia com o enum fixo, sem necessidade de bloquear.
categoriesRouter.delete('/:id', async (req, res) => {
  const existing = await prisma.expenseCategory.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
  if (!existing) {
    res.status(404).json({ error: 'Categoria não encontrada' });
    return;
  }
  await prisma.expenseCategory.delete({ where: { id: existing.id } });
  res.status(204).send();
});
