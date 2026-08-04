// Learn more https://docs.expo.dev/router/reference/static-rendering/#root-html

import { ScrollViewStyleReset } from 'expo-router/html';

// This file is web-only and used to configure the root HTML for every
// web page during static rendering.
// The contents of this function only run in Node.js environments and
// do not have access to the DOM or browser APIs.
export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />

        {/*
          Disable body scrolling on web. This makes ScrollView components work closer to how they do on native.
          However, body scrolling is often nice to have for mobile web. If you want to enable it, remove this line.
        */}
        <ScrollViewStyleReset />

        {/* Add any additional <head> elements that you want globally available on web... */}

        {/* favicon.ico vive sempre no mesmo caminho fixo entre deploys — sem
            um parâmetro de versão, o cache próprio do browser para favicons
            (mais agressivo e persistente do que o cache HTTP normal, sobrevive
            a recarregar a página) continua a mostrar o ícone antigo mesmo
            depois do ficheiro mudar no servidor. Subir este número sempre que
            favicon.png for substituído por um ícone visualmente diferente. */}
        <link rel="icon" href="/favicon.ico?v=2" />
      </head>
      <body>{children}</body>
    </html>
  );
}
