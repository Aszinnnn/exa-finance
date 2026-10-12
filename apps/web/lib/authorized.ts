import { createHash, timingSafeEqual } from 'node:crypto';
import { authenticatedUser, serverDb } from './supabase';

export async function authorizedUser(request: Request) {
  const user = await authenticatedUser(request);
  if (!user) return null;
  const id = request.headers.get('x-exa-device-id');
  const key = request.headers.get('x-exa-device-key');
  if (!id || !key || !/^[0-9a-f-]{36}$/.test(id) || !/^[0-9a-f]{64}$/.test(key)) return null;
  const db = serverDb();
  const { data: device } = await db.from('authorized_devices').select('id').eq('id', id).eq('user_id', user.id).is('revoked_at', null).maybeSingle();
  if (!device) return null;
  const { data: credential } = await db.from('device_credentials').select('key_hash').eq('device_id', id).maybeSingle();
  if (!credential) return null;
  const expected = Buffer.from(credential.key_hash, 'hex');
  const actual = createHash('sha256').update(key).digest();
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? user : null;
}
