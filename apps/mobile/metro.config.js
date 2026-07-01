// https://docs.expo.dev/guides/monorepos/ — necessário para o Metro resolver
// pacotes do workspace pnpm (ex: @invoice-scanner/shared), que ficam como
// symlinks fora de apps/mobile/node_modules.
const { getDefaultConfig } = require('expo/metro-config');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Nota: NÃO usar `disableHierarchicalLookup` aqui — esse ajuste é para
// monorepos Yarn/npm com node_modules hoisted. O pnpm usa um virtual store
// (.pnpm) com node_modules aninhados por pacote; desativar o lookup
// hierárquico impede o Metro de encontrar dependências transitivas lá dentro
// (foi exatamente isto que causou "Unable to resolve module @expo/metro-runtime").
config.watchFolders = [workspaceRoot];
config.resolver.unstable_enableSymlinks = true;

// Em Expo Go (LAN ou túnel), "localhost" no telemóvel aponta para o próprio
// telemóvel, não para este Mac — por isso o backend (porta 4001) fica
// inacessível a partir de app/src/api/config.ts se apontarmos para
// localhost:4001 diretamente. Em vez disso, o cliente aponta para
// "<host do Metro>/api" (ver resolveApiBaseUrl em src/api/config.ts) e este
// proxy reencaminha esse tráfego, dentro do próprio Mac, para o backend real.
// Isto funciona em qualquer modo de ligação (Web, LAN, túnel) sem alterações.
const apiProxy = createProxyMiddleware({
  target: 'http://localhost:4001',
  changeOrigin: true,
  pathRewrite: { '^/api': '' },
});

const originalEnhanceMiddleware = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (metroMiddleware, metroServer) => {
  const withOriginal = originalEnhanceMiddleware
    ? originalEnhanceMiddleware(metroMiddleware, metroServer)
    : metroMiddleware;
  return (req, res, next) => {
    if (req.url && req.url.startsWith('/api/')) {
      return apiProxy(req, res, next);
    }
    return withOriginal(req, res, next);
  };
};

module.exports = config;
