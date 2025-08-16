// project/src/integrations/supabase/client.ts
// Keep this file tiny and environment-driven.

import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// Read envs in a way that works for Vite (browser) and also tolerates Next-style names.
const ENV = (typeof import.meta !== 'undefined' ? (import.meta as any).env : {}) as Record<string, any>;

const SUPABASE_URL: string | undefined =
  ENV.VITE_SUPABASE_URL ?? ENV.NEXT_PUBLIC_SUPABASE_URL;

const SUPABASE_ANON_KEY: string | undefined =
  ENV.VITE_SUPABASE_ANON_KEY ?? ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  if (ENV?.DEV) {
    // Helpful during dev to see what keys exist
    // eslint-disable-next-line no-console
    console.warn('Supabase env missing. Available keys:', Object.keys(ENV));
  }
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
}

// Avoid touching localStorage during SSR/tests
const isBrowser = typeof window !== 'undefined' && typeof localStorage !== 'undefined';

// Build auth options conditionally so SSR doesn’t choke
const authOptions: Parameters<typeof createClient<Database>>[2] extends object ? any : never = {
  autoRefreshToken: true,
};
if (isBrowser) {
  authOptions.storage = localStorage;
  authOptions.persistSession = true;
}

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: authOptions,
});
