/**
 * Script de bootstrap, a correr uma única vez (localmente, no terminal do
 * utilizador): pnpm tsx scripts/get-gmail-refresh-token.ts
 *
 * Autoriza o acesso de leitura ao Gmail via OAuth2 (fluxo "Desktop app") e
 * grava o refresh token diretamente em .env — nunca o imprime no terminal,
 * para não ficar registado em nenhuma transcript.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { google } from 'googleapis';

const ENV_PATH = path.join(__dirname, '..', '.env');
const REDIRECT_URI = 'http://localhost:4321/oauth2callback';
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

function loadEnvFile(): Record<string, string> {
  if (!fs.existsSync(ENV_PATH)) return {};
  const result: Record<string, string> = {};
  for (const line of fs.readFileSync(ENV_PATH, 'utf-8').split('\n')) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) result[match[1]] = match[2].replace(/^"(.*)"$/, '$1');
  }
  return result;
}

function writeRefreshTokenToEnv(refreshToken: string): void {
  const existing = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf-8') : '';
  const line = `GOOGLE_REFRESH_TOKEN="${refreshToken}"`;
  const updated = /^GOOGLE_REFRESH_TOKEN=.*$/m.test(existing)
    ? existing.replace(/^GOOGLE_REFRESH_TOKEN=.*$/m, line)
    : `${existing.trimEnd()}\n${line}\n`;
  fs.writeFileSync(ENV_PATH, updated);
}

async function main() {
  const env = { ...loadEnvFile(), ...process.env };
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error(
      'Falta GOOGLE_CLIENT_ID e/ou GOOGLE_CLIENT_SECRET em apps/server/.env.\n' +
        'Cria credenciais OAuth "Desktop app" em https://console.cloud.google.com/ e adiciona-as ao .env antes de correr este script.',
    );
    process.exit(1);
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
  const authUrl = auth.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES });

  console.log('\nAbre este URL no browser e faz login com faturas.rag.hr@gmail.com:\n');
  console.log(authUrl);
  console.log('\nÀ espera do consentimento...\n');

  const refreshToken = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', REDIRECT_URI);
      if (url.pathname !== '/oauth2callback') {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get('code');
      const errorParam = url.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<p>Podes fechar esta janela e voltar ao terminal.</p>');
      server.close();

      if (errorParam || !code) {
        reject(new Error(errorParam ?? 'Nenhum código de autorização recebido'));
        return;
      }
      auth
        .getToken(code)
        .then(({ tokens }) => {
          if (!tokens.refresh_token) {
            reject(
              new Error(
                'O Google não devolveu um refresh token (normalmente acontece se já autorizaste esta app antes). ' +
                  'Revoga o acesso em https://myaccount.google.com/permissions e tenta novamente.',
              ),
            );
            return;
          }
          resolve(tokens.refresh_token);
        })
        .catch(reject);
    });
    server.listen(4321);
  });

  writeRefreshTokenToEnv(refreshToken);
  console.log('GOOGLE_REFRESH_TOKEN guardado em apps/server/.env. Reinicia o servidor para ativar o polling do Gmail.');
}

main().catch((err) => {
  console.error('Falhou:', err.message);
  process.exit(1);
});
