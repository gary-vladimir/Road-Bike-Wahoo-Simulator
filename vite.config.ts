import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'protect-local-generation-credentials',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          let path: string;
          try {
            path = decodeURIComponent((request.url ?? '').split('?')[0]);
          } catch {
            response.statusCode = 400;
            response.end();
            return;
          }
          if (/(?:^|\/)(?:token\.txt|\.secrets)(?:\/|$)/i.test(path)) {
            response.statusCode = 403;
            response.end('Local generation credentials are not served.');
            return;
          }
          next();
        });
      },
    },
  ],
  // Never hot-swap code under an active trainer-control session: reload deliberately instead.
  server: {
    hmr: false,
    fs: {
      deny: [
        '.env',
        '.env.*',
        '*.{crt,pem}',
        '**/.git/**',
        'token.txt',
        '**/token.txt',
        '**/.secrets/**',
      ],
    },
  },
});
