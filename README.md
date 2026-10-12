# EXA

Aplicativo pessoal web e Android com dados compartilhados no Supabase. O código atual inclui autenticação, contas, lançamentos simples, agenda, vínculo por QR, relatórios em PDF e agendamento de 30 dias. Leia [docs/IMPLEMENTACAO.md](docs/IMPLEMENTACAO.md) para a situação exata de cada requisito.

## Requisitos locais

- Node.js 20 ou superior e pnpm 11;
- projeto Supabase próprio;
- para APK: Android SDK, JDK e chave de assinatura, ou conta EAS Build;
- para envio automático: conta Meta WhatsApp Business Platform com número e template aprovados.

## Início rápido

1. Em um projeto Supabase novo, execute as migrations em ordem: `202610110001_initial.sql` e `20261012015458_harden_api_and_index_rls.sql`. O projeto EXA já configurado usa o projeto existente indicado pelo proprietário; não aplique migrations sem confirmar o projeto de destino.
2. Crie `apps/web/.env.local` com os valores correspondentes do `.env.example`.
3. Crie `apps/mobile/.env` com `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` e `EXPO_PUBLIC_APP_URL` apontando à URL HTTPS da web.
4. Execute `pnpm install` e `pnpm dev` na raiz para abrir a web.
5. Execute `pnpm --filter @exa/mobile start` para iniciar o projeto Android em modo de desenvolvimento.

O web e o Android usam a mesma conta Supabase. No Android, abra **Vínculo**; na web, abra **Configurações**, gere o QR e aprove o pedido.

## Verificação local

```bash
pnpm test
pnpm typecheck
pnpm build
```

O PDF pode ser gerado no navegador e compartilhado no Android via seletor nativo, com confirmação do usuário. A rotina de 30 dias usa `/api/cron/daily` na Vercel. Com custo zero, um disparo automático que possa ser cobrado fica bloqueado; o PDF permanece disponível para envio manual.

## Documentação

- [Implementação](docs/IMPLEMENTACAO.md)
- [Limitações](docs/LIMITACOES.md)
- [Segurança e pendências OWASP](docs/SEGURANCA.md)
- [Guia visual](visual-style.md)
- [Deploy Vercel](docs/DEPLOY_VERCEL.md)
- [Build Android](docs/BUILD_ANDROID.md)
- [Regras WhatsApp](EXA_V1_DECISOES_WHATSAPP.md)
