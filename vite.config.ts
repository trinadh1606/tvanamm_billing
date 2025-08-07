import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';
import tsconfigPaths from 'vite-plugin-tsconfig-paths';

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    tsconfigPaths()  // Automatically uses tsconfig.json for path resolution
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // You can manually add the 'supabase' alias if necessary:
      'supabase': path.resolve(__dirname, './supabase'),  // Ensure Vite can resolve this alias
    },
  },
});
