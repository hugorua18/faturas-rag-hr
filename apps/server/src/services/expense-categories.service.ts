import { EXPENSE_TYPES, EXPENSE_TYPE_LABELS, slugifyCategoryKey } from '@invoice-scanner/shared';
import type { ExpenseCategory } from '@prisma/client';
import { prisma } from '../db/prisma';

// Garante que o utilizador tem pelo menos uma categoria, semeando-as a partir
// do EXPENSE_TYPES fixo (histórico, pré-personalização) na primeira vez que
// são pedidas. O `key` semeado é EXACTAMENTE o mesmo que Expense.type já usa
// para despesas antigas — por isso não é preciso nenhuma migração de dados,
// as despesas existentes continuam a bater certo com a categoria seed.
export async function ensureUserCategories(userId: string): Promise<ExpenseCategory[]> {
  const existing = await prisma.expenseCategory.findMany({
    where: { userId },
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
  });
  if (existing.length > 0) return existing;

  await prisma.expenseCategory.createMany({
    data: EXPENSE_TYPES.map((key, index) => ({
      userId,
      key,
      label: EXPENSE_TYPE_LABELS[key],
      vatDeductible: null,
      sortOrder: index,
    })),
    skipDuplicates: true,
  });

  return prisma.expenseCategory.findMany({
    where: { userId },
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
  });
}

// Valida um Expense.type recebido do cliente contra as categorias reais do
// utilizador (substitui o antigo isExpenseType, que validava contra o enum
// fixo global — agora cada utilizador tem a sua própria lista). Semeia
// primeiro por segurança — uma conta nova a criar a sua primeira despesa sem
// nunca ter chamado GET /categories não deve falhar por falta de categorias.
export async function isValidCategoryKey(userId: string, key: string): Promise<boolean> {
  await ensureUserCategories(userId);
  const category = await prisma.expenseCategory.findUnique({ where: { userId_key: { userId, key } } });
  return category !== null;
}

// Nº de despesas do utilizador por categoria (Expense.type) — usado só para
// avisar antes de eliminar/alterar uma categoria já usada em faturas (ver
// routes/categories.ts); despesas não têm FK a ExpenseCategory (type é uma
// string solta), por isso nunca bloqueiam a operação, só avisam.
export async function categoryUsageCounts(userId: string): Promise<Map<string, number>> {
  const rows = await prisma.expense.groupBy({ by: ['type'], where: { userId }, _count: { _all: true } });
  return new Map(rows.map((row) => [row.type, row._count._all]));
}

// Deriva um `key` estável e único (por utilizador) a partir do nome escrito —
// acrescenta um sufixo numérico se já existir uma categoria com essa chave
// (ex: duas categorias chamadas "Outros" → OUTROS, OUTROS_2).
export async function generateUniqueCategoryKey(userId: string, label: string): Promise<string> {
  const base = slugifyCategoryKey(label);
  let key = base;
  let suffix = 2;
  while (await prisma.expenseCategory.findUnique({ where: { userId_key: { userId, key } } })) {
    key = `${base}_${suffix}`;
    suffix += 1;
  }
  return key;
}
