import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const appBrand = (env.VITE_APP_BRAND ?? '').trim() || '핀셋';
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        {
          name: 'html-brand',
          transformIndexHtml(html: string) {
            return html.replace(/__APP_BRAND__/g, appBrand);
          },
        },
      ],
      define: {},
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      build: {
        rollupOptions: {
          output: {
            manualChunks: (id) => {
              if (id.includes('node_modules')) {
                if (id.includes('firebase')) return 'firebase';
                if (id.includes('recharts')) return 'recharts';
                if (id.includes('katex')) return 'katex';
                if (id.includes('react-dom') || id.includes('react/')) return 'react-vendor';
                if (id.includes('framer-motion')) return 'framer-motion';
              }
            },
          },
        },
        chunkSizeWarningLimit: 600,
      },
    };
});
