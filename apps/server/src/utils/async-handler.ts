import type { NextFunction, Request, RequestHandler, Response } from 'express';

// O Express 4 nunca apanha uma promise rejeitada dentro de um handler async —
// em vez de cair no middleware de erro (ver index.ts), torna-se uma rejeição
// por tratar que derruba o processo inteiro (comportamento por omissão do
// Node desde a v15), tirando o servidor do ar para todos os utilizadores até
// o Render o reiniciar. Isto embrulha o handler para reencaminhar sempre o
// erro para next(), tal como um handler síncrono já faz sozinho ao lançar.
export function asyncHandler<
  Req extends Request = Request,
  Res extends Response = Response,
>(handler: (req: Req, res: Res, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    void handler(req as Req, res as Res, next).catch(next);
  };
}
