import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  // Never replace control code in a browser while a supervised pilot may be active.
  server: { hmr: process.env.VITE_TRAINER_CONTROL !== 'pilot' },
});
