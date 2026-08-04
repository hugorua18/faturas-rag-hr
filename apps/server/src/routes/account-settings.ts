import { Router } from 'express';
import type { AccountVatSettings, VatAutoFillMode } from '@invoice-scanner/shared';
import { prisma } from '../db/prisma';
import { asyncHandler } from '../utils/async-handler';

export const accountSettingsRouter = Router();

const VALID_AUTO_FILL_MODES = new Set(['SUPPLIER', 'CATEGORY']);

function toDto(user: { vatClassificationEnabled: boolean; vatAutoFillMode: string | null }): AccountVatSettings {
  return {
    vatClassificationEnabled: user.vatClassificationEnabled,
    vatAutoFillMode: user.vatAutoFillMode as VatAutoFillMode,
  };
}

accountSettingsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { vatClassificationEnabled: true, vatAutoFillMode: true },
    });
    res.json(toDto(user!));
  }),
);

// PUT /account-settings → liga/desliga a classificação de IVA dedutível e
// escolhe a fonte do pré-preenchimento automático (fornecedor OU categoria —
// um único campo nullable garante que nunca são os dois ao mesmo tempo).
accountSettingsRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    const body = req.body as { vatClassificationEnabled?: unknown; vatAutoFillMode?: unknown };
    const data: { vatClassificationEnabled?: boolean; vatAutoFillMode?: string | null } = {};

    if (body.vatClassificationEnabled !== undefined) {
      if (typeof body.vatClassificationEnabled !== 'boolean') {
        res.status(400).json({ error: 'vatClassificationEnabled tem de ser um boolean' });
        return;
      }
      data.vatClassificationEnabled = body.vatClassificationEnabled;
    }
    if (body.vatAutoFillMode !== undefined) {
      if (body.vatAutoFillMode !== null && !VALID_AUTO_FILL_MODES.has(body.vatAutoFillMode as string)) {
        res.status(400).json({ error: 'vatAutoFillMode tem de ser "SUPPLIER", "CATEGORY" ou null' });
        return;
      }
      data.vatAutoFillMode = body.vatAutoFillMode as string | null;
    }

    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data,
      select: { vatClassificationEnabled: true, vatAutoFillMode: true },
    });
    res.json(toDto(user));
  }),
);
