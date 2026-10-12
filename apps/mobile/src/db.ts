import 'react-native-url-polyfill/auto';
import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';

const storage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key)
};

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anon = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
let identity: string | null = null;
export function setMobileIdentity(id: string | null) { identity = id; }
export function mobileStorageKey(name: string, id: string) { return `exa-${name}.${id}`; }
export async function deviceHeaders(): Promise<Record<string, string>> {
  if (!identity) return {};
  const id = await SecureStore.getItemAsync(mobileStorageKey('device-id',identity));
  const key = await SecureStore.getItemAsync(mobileStorageKey('device-key',identity));
  return id && key ? { 'x-exa-device-id': id, 'x-exa-device-key': key } : {};
}

export const db = url && anon ? createClient(url, anon, {
  auth: { storage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
  global: { fetch: async (input, init) => {
    const headers = new Headers(init?.headers);
    const target = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (target.origin === new URL(url).origin && target.pathname.startsWith('/rest/v1/')) {
      for (const [name, value] of Object.entries(await deviceHeaders())) headers.set(name, value);
    }
    return fetch(input, { ...init, headers });
  } }
}) : null;
