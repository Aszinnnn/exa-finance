import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { serverDb } from '@/lib/server-supabase';
import { authorizedUser } from '@/lib/authorized';
import { apiLimit, limitedJson } from '@/lib/security';

export async function POST(request: Request) {
  const user = await authorizedUser(request);
  if (!user) return Response.json({ error: 'Sessão inválida.' }, { status: 401 });
  const limited = await apiLimit(user.id, 'pairing_create');
  if (limited) return limited;
  const input = z.object({ source_device_id: z.uuid() }).safeParse(await limitedJson(request));
  if (!input.success) return Response.json({ error: 'Dispositivo inválido.' }, { status: 400 });
  const db = serverDb();
  const { data: source } = await db.from('authorized_devices').select('id').eq('id', input.data.source_device_id).eq('user_id', user.id).eq('kind', 'web').is('revoked_at', null).maybeSingle();
  if (!source) return Response.json({ error: 'Navegador não autorizado.' }, { status: 403 });
  const nonce = randomBytes(32).toString('hex');
  const { data, error } = await db.from('pairing_sessions').insert({ user_id: user.id, source_device_id: source.id,
    nonce_hash: createHash('sha256').update(nonce).digest('hex'), expires_at: new Date(Date.now() + 5 * 60_000).toISOString() })
    .select('id,expires_at').single();
  if (error || !data) return Response.json({ error: 'Falha ao criar vínculo.' }, { status: 500 });
  return Response.json({ ...data, link: `exa://pair?session=${data.id}&nonce=${nonce}` }, { headers: { 'Cache-Control': 'no-store' } });
}
