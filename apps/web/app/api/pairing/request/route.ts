import { createHash } from 'node:crypto';
import { z } from 'zod';
import { authenticatedUser, serverDb } from '@/lib/server-supabase';
import { apiLimit, limitedJson } from '@/lib/security';

const input = z.object({ session_id: z.uuid(), nonce: z.string().length(64).regex(/^[a-f0-9]+$/), installation_hash: z.string().length(64).regex(/^[a-f0-9]+$/), device_key_hash: z.string().length(64).regex(/^[a-f0-9]+$/), device_name: z.string().trim().min(1).max(80) });

export async function POST(request: Request) {
  const user = await authenticatedUser(request);
  if (!user) return Response.json({ error: 'Sessão inválida.' }, { status: 401 });
  const limited = await apiLimit(user.id, 'pairing_request');
  if (limited) return limited;
  const parsed = input.safeParse(await limitedJson(request));
  if (!parsed.success) return Response.json({ error: 'QR inválido.' }, { status: 400 });
  const db = serverDb();
  const hash = createHash('sha256').update(parsed.data.nonce).digest('hex');
  const { data, error } = await db.from('pairing_sessions').update({ status: 'requested', requested_device_hash: parsed.data.installation_hash, requested_device_key_hash: parsed.data.device_key_hash, requested_device_name: parsed.data.device_name })
    .eq('id', parsed.data.session_id).eq('user_id', user.id).eq('nonce_hash', hash).eq('status', 'created').gt('expires_at', new Date().toISOString()).select('id').maybeSingle();
  if (error || !data) return Response.json({ error: 'QR expirado, inválido ou já usado.' }, { status: 409 });
  return Response.json({ status: 'requested' });
}
