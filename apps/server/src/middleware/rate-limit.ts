import rateLimit from 'express-rate-limit';

// Sem isto, nada impede um chamador (com ou sem sessão válida) de martelar em
// loop os endpoints mais caros — o login (antes de haver sessão) e o
// upload/OCR/geração de relatórios (canvas + Tesseract + pdfmake/exceljs),
// tudo a correr no único worker do plano gratuito do Render. Limites generosos
// para uma app de utilização pessoal — nunca deviam ser atingidos em uso normal.
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas tentativas de início de sessão — tenta novamente daqui a uns minutos.' },
});

export const heavyRouteRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados pedidos — tenta novamente daqui a uns minutos.' },
});
