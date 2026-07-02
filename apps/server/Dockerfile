FROM node:20-bookworm-slim AS base

# tesseract-ocr-por: dados de treino em português — necessário para o fallback
# OCR (ver ocr.service.ts, que corre "tesseract ... -l por").
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-por \
    && rm -rf /var/lib/apt/lists/*

# "corepack enable" por si só não fixa a versão — isso vem do campo
# "packageManager" (pnpm@9.15.9) do package.json raiz, lido assim que é copiado.
RUN corepack enable

WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/

RUN pnpm install --frozen-lockfile --filter @invoice-scanner/server...

COPY packages/shared packages/shared
COPY apps/server apps/server

# packages/shared não tem "main" apontado para .ts — precisa de ser compilado
# para dist/ antes do server, cujo "node dist/index.js" (CommonJS, sem
# tsx/ts-node) não consegue resolver imports extensionless para ficheiros .ts.
RUN pnpm --filter @invoice-scanner/shared build

# @prisma/client só existe com tipos (PrismaClient, User, etc.) depois de
# "prisma generate" correr contra prisma/schema.prisma — não há postinstall
# automático para isto, tem de ser explícito antes do tsc do server.
RUN pnpm --filter @invoice-scanner/server exec prisma generate

RUN pnpm --filter @invoice-scanner/server build

WORKDIR /app/apps/server

EXPOSE 4001

CMD ["node", "dist/index.js"]
