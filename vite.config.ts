import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';
import tsconfigPaths from 'vite-plugin-tsconfig-paths';

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: '::',          // listen on all interfaces (IPv4/IPv6)
    port: 5173,          // dev server on 5173 to avoid clashing with backend on 8080
    strictPort: true,    // fail if 5173 is taken (so you notice)
    proxy: {
      // Proxy API requests during dev to your backend on 8080
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        // If your backend needs cookies or auth headers, you can tweak here:
        // secure: false,
        // rewrite: (path) => path, // default passthrough
      },
      // If you also use Supabase Edge Functions locally, uncomment this:
      // '/functions/v1': {
      //   target: 'http://127.0.0.1:54321', // Supabase local dev default
      //   changeOrigin: true,
      // },
    },
  },
  preview: {
    host: '::',
    port: 4173,
  },
  plugins: [
    react(),
    tsconfigPaths(),  // Automatically uses tsconfig.json for path resolution
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // You can manually add the 'supabase' alias if necessary:
      'supabase': path.resolve(__dirname, './supabase'),
    },
  },
  // Optional: tighten build target if you like modern output
  build: {
    target: 'es2020',
  },
});
