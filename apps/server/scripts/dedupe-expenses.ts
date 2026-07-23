// Deteta (e com --apply remove) despesas duplicadas: mesmo utilizador com o
// mesmo fornecedor + valor total + número de documento. Acontece quando a
// mesma fatura entra por dois caminhos (câmara + email) ou após recuperações.
//
//   pnpm exec tsx scripts/dedupe-expenses.ts            ← só mostra os grupos
//   pnpm exec tsx scripts/dedupe-expenses.ts --apply    ← remove os duplicados
//
// Regras de segurança: só considera duplicado quando o NÚMERO DE DOCUMENTO
// existe e coincide (duas despesas sem número nunca são tocadas — dois cafés
// do mesmo valor no mesmo dia são legítimos). Em cada grupo mantém-se a
// despesa mais completa: com cópia no Drive > submetida > com valores; em
// empate, a mais antiga. As restantes são apagadas (os ficheiros no Drive
// nunca são tocados).
import { prisma } from '../src/db/prisma';

const APPLY = process.argv.includes('--apply');

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
}

type Candidate = {
  id: string;
  userId: string | null;
  status: string;
  source: string;
  supplierName: string | null;
  supplierNif: string | null;
  documentId: string | null;
  documentDate: string | null;
  amountTotal: number | null;
  driveFileId: string | null;
  createdAt: Date;
};

function score(expense: Candidate): number {
  return (
    (expense.driveFileId ? 4 : 0) +
    (expense.status === 'SUBMETIDA' ? 2 : 0) +
    (expense.amountTotal != null ? 1 : 0)
  );
}

async function main() {
  const expenses = (await prisma.expense.findMany({
    select: {
      id: true,
      userId: true,
      status: true,
      source: true,
      supplierName: true,
      supplierNif: true,
      documentId: true,
      documentDate: true,
      amountTotal: true,
      driveFileId: true,
      createdAt: true,
    },
  })) as Candidate[];

  const groups = new Map<string, Candidate[]>();
  for (const expense of expenses) {
    const docId = normalize(expense.documentId);
    if (!docId) continue; // sem número de documento não há certeza de duplicado
    const supplier = normalize(expense.supplierNif) || normalize(expense.supplierName);
    const total = expense.amountTotal != null ? expense.amountTotal.toFixed(2) : '';
    const key = [expense.userId ?? 'orfã', docId, supplier, total].join('§');
    const bucket = groups.get(key) ?? [];
    bucket.push(expense);
    groups.set(key, bucket);
  }

  let removed = 0;
  let groupCount = 0;
  for (const [, bucket] of groups) {
    if (bucket.length < 2) continue;
    groupCount++;
    bucket.sort((a, b) => score(b) - score(a) || a.createdAt.getTime() - b.createdAt.getTime());
    const [keep, ...duplicates] = bucket;
    console.log(
      `\nGrupo: doc "${keep.documentId}" | ${keep.supplierName ?? keep.supplierNif ?? 'fornecedor?'} | ` +
        `${keep.amountTotal ?? '?'} €`,
    );
    console.log(`  MANTÉM  ${keep.id.slice(0, 8)}…  ${keep.source}/${keep.status}  drive=${keep.driveFileId ? 'sim' : 'não'}`);
    for (const dup of duplicates) {
      console.log(`  ${APPLY ? 'APAGA ' : 'apagaria'} ${dup.id.slice(0, 8)}…  ${dup.source}/${dup.status}  drive=${dup.driveFileId ? 'sim' : 'não'}`);
      removed++;
    }
    if (APPLY) {
      await prisma.expense.deleteMany({ where: { id: { in: duplicates.map((d) => d.id) } } });
    }
  }

  console.log(
    `\n${groupCount} grupo(s) de duplicados; ${APPLY ? 'removidas' : 'a remover (simulação)'}: ${removed} despesa(s).` +
      (APPLY ? '' : ' Corre com --apply para remover.'),
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
