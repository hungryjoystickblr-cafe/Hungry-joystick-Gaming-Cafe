import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // This app uses plain CSS. Do not inherit the original app's Tailwind
  // PostCSS configuration from the repository root during Git builds.
  css: { postcss: { plugins: [] } },
});
