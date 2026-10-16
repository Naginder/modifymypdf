import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  plugins: [react(), {
    name: 'bundled-license-notices',
    generateBundle() {
      const locations = [
        'react', 'react-dom', 'scheduler', 'pdf-lib', 'pdfjs-dist',
        'pdfjs-dist/cmaps', 'pdfjs-dist/standard_fonts', 'pdfjs-dist/wasm',
        '@pdf-lib/standard-fonts', '@pdf-lib/upng', 'pako', 'tslib',
      ];
      const notices = locations.flatMap((location) => {
        const directory = resolve('node_modules', location);
        return readdirSync(directory).filter((name) => /^(LICENSE|COPYING|COPYRIGHT)/i.test(name))
          .map((name) => `${location} — ${name}\n\n${readFileSync(resolve(directory, name), 'utf8')}`);
      });
      this.emitFile({ type: 'asset', fileName: 'third-party-licenses.txt', source: notices.join('\n\n--------------------\n\n') });
    },
  }],
  worker: { format: 'es' },
  build: { target: 'es2022' },
});
