import { prisma } from '../db/prisma';

// Quando a classificação de IVA dedutível está ativa com preenchimento
// automático por fornecedor ou categoria, cada fatura submetida "ensina" o
// sistema — o valor escolhido fica como pré-preenchimento por omissão da
// próxima fatura do mesmo fornecedor/categoria (ver hooks/use-vat-deductible-
// autofill.ts no cliente). Best-effort e nunca lança: os chamadores disparam
// isto sem "await" a seguir à resposta, tal como archiveInvoiceToDriveBestEffort.
export async function learnVatDeductible(
  userId: string,
  vatAutoFillMode: string | null,
  supplierNif: string | null | undefined,
  categoryKey: string,
  vatDeductible: boolean | null | undefined,
): Promise<void> {
  if (vatDeductible === null || vatDeductible === undefined) return;

  try {
    if (vatAutoFillMode === 'SUPPLIER' && supplierNif) {
      await prisma.supplierVatDefault.upsert({
        where: { userId_supplierNif: { userId, supplierNif } },
        create: { userId, supplierNif, vatDeductible },
        update: { vatDeductible },
      });
    } else if (vatAutoFillMode === 'CATEGORY') {
      // A categoria pode ter sido apagada entretanto (Expense.type é uma
      // string solta, sem FK) — nesse caso não há onde guardar o valor
      // aprendido, e isso é normal, não um erro.
      await prisma.expenseCategory.update({
        where: { userId_key: { userId, key: categoryKey } },
        data: { vatDeductible },
      });
    }
  } catch (err) {
    console.error(`[vat-learning] falha ao guardar valor aprendido (userId=${userId})`, err);
  }
}
