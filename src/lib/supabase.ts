import { createClient, SupabaseClient } from '@supabase/supabase-js';

const getStoredConfig = () => {
  try {
    const customUrl = localStorage.getItem('supabase_url');
    const customKey = localStorage.getItem('supabase_key');
    if (customUrl && customKey) {
      return { url: customUrl.trim(), key: customKey.trim() };
    }
  } catch (e) {
    // Ignore
  }
  return {
    url: ((import.meta as any).env?.VITE_SUPABASE_URL || '').trim(),
    key: ((import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '').trim()
  };
};

const config = getStoredConfig();

let client: SupabaseClient | null = null;
try {
  if (
    config.url && 
    config.key && 
    (config.url.startsWith('http://') || config.url.startsWith('https://')) &&
    !config.url.includes('YOUR_SUPABASE_URL')
  ) {
    client = createClient(config.url, config.key);
  }
} catch (err) {
  console.error("Error initializing Supabase client:", err);
  client = null;
}

export const supabase = client;

export const updateSupabaseCredentials = (url: string, key: string) => {
  try {
    localStorage.setItem('supabase_url', url.trim());
    localStorage.setItem('supabase_key', key.trim());
    window.location.reload();
  } catch (e) {
    console.error("Failed to save Supabase credentials", e);
  }
};
