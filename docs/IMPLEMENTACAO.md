# Estado da implementação

## Arquitetura

- `apps/web`: Next.js, interface responsiva e rotas de relatórios, vínculo, cron e webhook Meta.
- `apps/mobile`: Expo/React Native com login, consultas e gravações no mesmo Supabase, leitura de QR e compartilhamento nativo do PDF.
- `packages/domain`: parsing BRL, distribuição exata de parcelas, resumo de ledger, validação Zod e testes unitários.
- `supabase/migrations`: PostgreSQL com RLS, limite transacional de cinco dispositivos, entidades de finanças/agenda e jobs de relatório.

## Implementado em código

- Cadastro e login por e-mail/senha no Supabase Auth.
- Web: conta, receita/despesa, cartões, compras parceladas, faturas, pagamento parcial/total, agenda, painel com dados reais e relatórios.
- Android: conta, receita/despesa, agenda e PDF, com sessão no SecureStore.
- Supabase Realtime com nova consulta após eventos e retorno ao foco na web.
- QR de 5 minutos com nonce aleatório; login na mesma conta e aprovação no navegador.
- Limite de cinco dispositivos ativos sob bloqueio transacional PostgreSQL, credencial por instalação e revogação conferida por RLS e APIs de relatório.
- PDF em memória, período de até 366 dias, sem cache público; resumo, comparação com período anterior quando há dados, lançamentos e faturas detalhadas. Parcelas entram no gasto por data de fechamento, e pagamento da fatura entra apenas na saída de caixa.
- Compartilhamento do PDF pelo Android Sharesheet e download/compartilhamento compatível no navegador.
- Rotina por usuário a cada 30 dias com cron diário da Vercel e chave única por ciclo.
- Pedido antecipado sem mudar o próximo ciclo.
- Gateway Meta Cloud API para upload do PDF e envio com template documental, condicionado a credenciais, template aprovado, consentimento e permissão explícita para possível cobrança.
- Webhook assinado para atualizar status de entrega.
- Revisão inicial de segurança: CSP com nonce, validação e limites de payload, rate limiting por usuário nas rotas sensíveis, RLS dos jobs em somente leitura e proteção contra edição direta de pagamento de fatura. Detalhes e pendências em `docs/SEGURANCA.md`.

## Verificações executadas neste ambiente

- `pnpm --filter @exa/domain test`: 4 testes passaram.
- `pnpm --filter @exa/web typecheck`: passou.
- `pnpm --filter @exa/mobile typecheck`: passou.
- `pnpm --filter @exa/web build`: passou após inclusão das proteções e do guia visual.
- Rotas sem sessão/configuração: relatório e vínculo retornam 401, webhook retorna 403 e cron sem segredo retorna 401.
- `pnpm --filter @exa/mobile exec expo export --platform android --output-dir /tmp/exa-android-export`: bundle Android gerado pelo Metro.
- `pnpm audit --prod`: 4 avisos transitivos remanescentes no toolchain Expo/Metro (2 altos, 2 moderados). `postcss` e `image-size` foram atualizados por override e o export Android foi repetido com sucesso.
- Preview local: página web respondeu HTTP 200; CSP e nonce nos scripts foram verificados no HTML. Sem variáveis reais, o modo produção exibe a tela de configuração.

Não houve projeto Supabase configurado, número Meta configurado, Vercel autenticada nem Android SDK/JDK no ambiente. Por isso, migrations, RLS real, integração web/Android, envio Meta e instalação de APK não foram validados em serviços reais.

## Fluxo de 30 dias

1. O usuário habilita a rotina em Configurações. `next_delivery_at` recebe a data de ativação mais 30 dias.
2. A Vercel chama `/api/cron/daily` diariamente com `CRON_SECRET`.
3. A função `claim_due_report_jobs` cria um job por usuário/ciclo e avança exatamente 30 dias desde o ciclo anterior.
4. Em modo manual, o job fica `awaiting_manual_share` e a web permite gerar o PDF daquele intervalo.
5. Em modo Meta com política de custo zero, o job fica `blocked_by_zero_cost_policy`; o usuário pode compartilhar o PDF manualmente.
6. Em modo Meta com possível cobrança explicitamente aceita pelo usuário e habilitada no servidor, o PDF é gerado e enviado pela Cloud API. O estado `delivered` só vem do webhook.

## Próximo trabalho para V1 integral

1. Concluir importação CSV/OFX e reconciliação de saldos por caixa/competência; testar as funções de cartões/faturas num PostgreSQL real.
2. Testar em Supabase real a função RLS de dispositivo e a revogação imediata, incluindo concorrência e alteração de cabeçalhos. O bloqueio está implementado no código, mas não passou por teste integrado em banco.
3. Concluir edição e exclusão lógica com controle de versão, recuperação de senha, proteção de login/cadastro contra abuso, testes de corrida e E2E.
4. Concluir lembretes Android, comandos de voz EXA, WOL local e agente LAN opcional.
5. Configurar e testar Supabase, Vercel e Meta em contas reais; gerar e instalar um APK release assinado.
