# Deploy web: Supabase + Vercel

1. Para o ambiente EXA já preparado, use o projeto Supabase existente definido pelo proprietário; habilite Auth por e-mail/senha e configure confirmação de e-mail e URL de redirecionamento HTTPS do domínio EXA. Não crie um segundo projeto por causa da publicação do código.
2. Em uma instalação Supabase nova, execute as migrations `202610110001_initial.sql` e `20261012015458_harden_api_and_index_rls.sql`, em ordem. Faça testes de isolamento com dois usuários antes de inserir dados pessoais.
3. Na Vercel, importe o repositório via integração GitHub → Vercel e defina `apps/web` como Root Directory. Mantenha instalação pelo pnpm do monorepo. Se a Vercel não detectar o workspace, use `pnpm install --frozen-lockfile` na instalação e `pnpm --filter @exa/web build` no build.
4. Configure `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` e `CRON_SECRET` no ambiente Production. Nunca use `NEXT_PUBLIC_` em chaves privadas. A aplicação aceita as chaves legadas `anon`/`service_role` como alternativa, mas prefira as novas chaves do Supabase.
5. Confirme que `apps/web/vercel.json` registra o cron diário. Preview deployments não devem usar segredos de produção nem enviar mensagens reais.
6. Para Meta, configure `WHATSAPP_CLOUD_API_ENABLED=true`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_APP_SECRET` e `WHATSAPP_WEBHOOK_VERIFY_TOKEN` só depois da aprovação externa. Configure o webhook em `/api/webhooks/whatsapp`.
7. Para permitir mensagens possivelmente tarifadas, o servidor exige `WHATSAPP_ALLOW_BILLABLE=true` e consentimento do usuário no EXA. O padrão é `false`.
8. Teste cadastro, conta, lançamento, evento, QR, PDF, cron idempotente e status Meta com dados de teste.

Sem as contas e credenciais externas, estes passos são instruções reproduzíveis; nenhum deploy foi realizado.
