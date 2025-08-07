// src/supabase/supabaseClient.js
import { createClient } from '@supabase/supabase-js';

// Using Vite-specific environment variable prefixes with import.meta.env
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;  // Access VITE_ prefixed environment variable
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY;  // Access VITE_ prefixed environment variable

// Export the supabase client
export const supabase = createClient(supabaseUrl, supabaseKey);
