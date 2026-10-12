# Segurança da V1 — revisão orientada por OWASP ASVS

Este registro distingue controles implementados em código de garantias testadas em produção. Não constitui certificação OWASP.

## Controles implementados

| Risco | Controle | Evidência no projeto |
| --- | --- | --- |
| Acesso a dados de outro usuário | RLS em tabelas financeiras, agenda e relatórios; filtro por `auth.uid()` e dispositivo ativo | `supabase/migrations/202610110001_initial.sql` |
| Acesso após revogação | Credencial aleatória por instalação, apenas hash no banco; RLS e rotas verificam dispositivo não revogado | migration, `apps/web/lib/authorized.ts` |
| Escalada por função de banco | RPCs sensíveis validam usuário/dispositivo; funções de serviço não são executáveis por `anon`/`authenticated` | migration |
| Falsificação de dados de entrega | Jobs de relatório são escritos só pelo servidor; usuário tem apenas leitura | política RLS `report_delivery_jobs` |
| Alteração de pagamento de fatura | Lançamento `invoice_payment` não pode ser inserido ou atualizado diretamente pelo cliente; apenas `pay_invoice` cria o par transacional | RLS e RPC na migration |
| Excesso de requisições autenticadas | Contador atômico por usuário/ação com resposta 429 e `Retry-After`; limites também no tamanho do JSON | `consume_api_limit`, `apps/web/lib/security.ts` |
| Injeção e entradas inválidas | Validação Zod nas rotas, constraints PostgreSQL, texto React escapado por padrão, sem SQL construído com entrada do usuário | `packages/domain`, rotas, migration |
| XSS e carregamento externo | CSP com nonce por resposta, sem fonte remota, `object-src none`, `frame-ancestors none`; cabeçalhos `nosniff` e referrer | `apps/web/middleware.ts`, `next.config.ts` |
| PDF exposto em cache | Resposta `private, no-store`, nome de arquivo derivado de datas validadas | `apps/web/app/api/reports/generate/route.ts` |
| Webhook falso ou grande | Assinatura HMAC SHA-256 sobre bytes originais, comparação constante, limite de 64 KiB; entrega não regride após confirmada | `apps/web/app/api/webhooks/whatsapp/route.ts` |
| Envio inesperado/cobrança | Consentimento do destinatário, opt-in separado para possível custo, bloqueio por padrão de envio potencialmente tarifável | `apps/web/lib/delivery.ts`, migration |

## Pendências antes de disponibilizar dados reais

1. As migrations foram aplicadas ao projeto Supabase EXA existente. Ainda é necessário executar cenários de RLS entre dois usuários, dispositivo revogado, cabeçalhos ausentes/falsos e concorrência no quinto vínculo antes de inserir dados reais.
2. Testar fluxo completo de login, recuperação de senha, expiração/refresh de sessão e revogação simultânea na web e Android. A chave web atualmente fica no `localStorage`: XSS ainda pode expô-la apesar da CSP; migrar para arquitetura com segredo não acessível a JavaScript antes de uso de alta sensibilidade.
3. Executar testes dinâmicos de autorização, abuso de API, input malformado, CSP nos navegadores-alvo e varredura de dependências. O controle de taxa atual é por usuário autenticado, não protege cadastro/login do Supabase nem distribuições de IP.
4. Configurar segredos exclusivamente no ambiente da hospedagem, rotação, backup/restauração, logs sem dados sensíveis e monitoramento de falhas. Nunca pôr `SUPABASE_SECRET_KEY` ou token Meta em variáveis públicas.
5. Verificar política de preços e template Meta reais. Projeto pequeno não garante gratuidade; com política custo zero o envio Cloud API é bloqueado quando houver possibilidade de cobrança.
6. Auditar limites de volume e paginação. O gerador falha em vez de emitir PDF incompleto quando o Supabase trunca uma consulta. O saldo do painel agora vem de agregação no banco sobre todos os lançamentos, enquanto a lista visual permanece limitada a 200.
7. `pnpm audit --prod` ainda aponta 4 avisos em dependências transitivas do toolchain Expo/Metro (2 altos: `node-forge`, `braces`; 2 moderados: `uuid`, `sprintf-js`). Os avisos de `postcss` e `image-size` foram eliminados com versões corrigidas e o bundle Android continuou exportando. Atualizar/mitigar os transitivos restantes e validar a cadeia de build antes de distribuir o APK. Não afirmar que o projeto está livre de vulnerabilidades.

Referências: [OWASP ASVS](https://owasp.org/projects/asvs/), [Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) e [Next.js CSP](https://nextjs.org/docs/15/app/guides/content-security-policy).
