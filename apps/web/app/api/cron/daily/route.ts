import { processDelivery } from '@/lib/delivery';
import { serverDb } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return Response.json({ error: 'Acesso negado.' }, { status: 401 });
  const db = serverDb();
  const { error } = await db.rpc('claim_due_report_jobs', { p_limit: 20 });
  if (error) return Response.json({ error: 'Falha no agendamento.' }, { status: 500 });
  // Include jobs left unprocessed when an earlier cron run ended after inserting them.
  const { data, error: pendingError } = await db.from('report_delivery_jobs')
    .select('id,user_id,period_from,period_to,status').eq('origin', 'scheduled').eq('status', 'scheduled').order('requested_at').limit(20);
  if (pendingError) return Response.json({ error: 'Falha ao consultar entregas.' }, { status: 500 });
  const results = [];
  for (const job of data ?? []) results.push({ id: job.id, status: await processDelivery(job) });
  return Response.json({ processed: results.length, results });
}
