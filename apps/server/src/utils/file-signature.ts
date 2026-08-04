// O multer fileFilter só vê o Content-Type DECLARADO pelo cliente no pedido
// multipart — trivialmente falsificável (ex: enviar texto/HTML com
// Content-Type: image/jpeg). Isto confirma os primeiros bytes do ficheiro já
// gravado em disco contra as assinaturas reais dos tipos permitidos, para
// nunca servir/arquivar como imagem/PDF algo que não é.
export function detectRealFileType(buffer: Buffer): 'image/jpeg' | 'image/png' | 'application/pdf' | null {
  if (buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length > 4 && buffer.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  return null;
}
