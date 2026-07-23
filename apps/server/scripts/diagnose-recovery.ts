// Diagnóstico (SÓ LEITURA) para a recuperação de despesas: mostra que
// utilizadores existem, quantas despesas tem cada um (por origem/estado),
// quantas têm cópia no Drive, e se há despesas órfãs. Serve para decidir
// entre reatribuir registos existentes ou reconstruir a partir do Drive.
import { prisma } from '../src/db/prisma';

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, createdAt: true, googleRefreshTokenEnc: true },
    orderBy: { createdAt: 'asc' },
  });

  for (const user of users) {
    const groups = await prisma.expense.groupBy({
      by: ['source', 'status'],
      where: { userId: user.id },
      _count: { _all: true },
    });
    const withDrive = await prisma.expense.count({
      where: { userId: user.id, driveFileId: { not: null } },
    });
    console.log(
      `\nUtilizador: ${user.email}  (criado ${user.createdAt.toISOString().slice(0, 10)}, ` +
        `refreshToken=${user.googleRefreshTokenEnc ? 'SIM' : 'NÃO'}, id=${user.id.slice(0, 8)}…)`,
    );
    if (groups.length === 0) {
      console.log('  sem despesas');
    }
    for (const group of groups) {
      console.log(`  ${group.source}/${group.status}: ${group._count._all}`);
    }
    console.log(`  com cópia no Drive (driveFileId): ${withDrive}`);
  }

  const orphans = await prisma.expense.count({ where: { userId: null } });
  const total = await prisma.expense.count();
  console.log(`\nDespesas órfãs (sem utilizador): ${orphans}`);
  console.log(`Total de despesas na base: ${total}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
