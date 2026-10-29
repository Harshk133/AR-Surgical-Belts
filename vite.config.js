import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The AR engine (three + MediaPipe) is loaded with dynamic import() when the user starts the
// try-on or scrolls to the 3D viewer, so the first paint only ships the React shell.
export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173 },
  build: { target: 'es2020', chunkSizeWarningLimit: 900 },
  optimizeDeps: { exclude: ['@mediapipe/tasks-vision'] },
});
