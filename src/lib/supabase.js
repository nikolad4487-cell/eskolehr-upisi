import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const hasRealSupabaseUrl = Boolean(
  supabaseUrl
    && /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl)
    && !supabaseUrl.includes('your-project')
);

const hasRealAnonKey = Boolean(
  supabaseAnonKey
    && supabaseAnonKey.length > 40
    && supabaseAnonKey !== 'your-anon-key'
);

export const hasSupabaseConfig = hasRealSupabaseUrl && hasRealAnonKey;

export const supabase = hasSupabaseConfig
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
