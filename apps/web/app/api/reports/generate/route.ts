import { reportPeriod } from '@exa/domain';
import { authorizedUser } from '@/lib/authorized';
import { generateReport } from '@/lib/report';
import { apiLimit, limitedJson } from '@/lib/security';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const user = await authorizedUser(request);
  if (!user) return Response.json({ error: 'Sessão inválida.' }, { status: 401 });
  const limited = await apiLimit(user.id, 'report_generate');
  if (limited) return limited;
  const parsed = reportPeriod.safeParse(await limitedJson(request));
  if (!parsed.success) return Response.json({ error: 'Período inválido.' }, { status: 400 });
  try {
    const bytes = await generateReport(user.id, parsed.data.from, parsed.data.to);
    return new Response(Buffer.from(bytes), { headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="EXA-${parsed.data.from}-${parsed.data.to}.pdf"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff'
    } });
  } catch {
    return Response.json({ error: 'Não foi possível gerar o relatório.' }, { status: 500 });
  }
}
