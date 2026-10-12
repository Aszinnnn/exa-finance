# Auditoria e correções EXA — 12/10/2026

Escopo: código web/Android, banco `exa-finance` (`alqkrpjetsrdlbjuxkrj`), configuração observável e artefato Android existente. Não é certificação OWASP, pentest completo nem garantia de ausência de vulnerabilidades. Não houve varredura intrusiva na infraestrutura compartilhada da Vercel/Supabase.

## Causas confirmadas

- **Gravação bloqueada:** a função RLS `has_active_device()` utilizava `device_id` como variável e coluna. PostgreSQL retornava SQLSTATE 42702, ambiguidade. Corrigido e testado no projeto existente.
- **Confirmação 404:** `/auth/confirm` não existia. Auth estava com confirmação de e-mail habilitada. A confirmação pode ocorrer antes do redirecionamento quebrado; conseguir entrar depois disso não prova bypass. Adicionadas páginas de retorno, validação autoritativa de usuário e reenvio. Proprietário informou ter configurado Site URL/Redirect URL corretos.
- **Inicialização:** dados eram consultados antes do cadastro/autorização do dispositivo. Agora o painel espera autorização. Chaves locais são separadas por usuário; resultados assíncronos de outra sessão são descartados.
- **Inteiros:** conversor exigia centavos. Agora aceita `100`, `100,5`, `100,50`, `1.000` e `1.000,50`, mantendo rejeição de formatos ambíguos, notação exponencial e overflow.
- **APK:** arquivo local tem ZIP íntegro, ARM64 e segmentos ELF ARM64 com alinhamento de pelo menos 16 KB. Isso não prova instalação no S24 FE. Não foi obtido erro do Package Installer/ADB; causa do congelamento continua em investigação.

## Controles auditados (15 etapas)

| Etapa | Verificação e resultado | Limitação / ação restante |
|---|---|---|
| 1. Segredos no versionamento | `.env`, APK e keystore ignorados; varredura de padrões não encontrou chaves privadas nos arquivos selecionados | Varredura por padrões não detecta todos os segredos; senha já enviada em conversa deve ser trocada pelo proprietário |
| 2. Fronteira servidor/navegador | Cliente administrativo movido para módulo `server-only`; nenhum componente importa a chave privilegiada | URL e chave **publishable** do Supabase são públicas por projeto; proteção real é Auth + RLS, não esconder URL |
| 3. Confirmação de conta | RPCs verificam `auth.users.email_confirmed_at`, exclusão e bloqueio; API valida usuário com Auth | Testar recebimento do e-mail em caixa real; não acessar mensagens pessoais nem consumir tokens do proprietário |
| 4. Isolamento/RLS | Todas as tabelas públicas existentes têm RLS; teste de escrita fora da conta é negado | Executar regressões sempre que criar tabelas/políticas |
| 5. Privilégio mínimo | Defaults antigos incluíam privilégios excessivos (inclusive TRUNCATE). Todos os grants de tabela foram redefinidos: anon sem acesso; authenticated somente SELECT/INSERT/UPDATE onde necessário, SELECT nas tabelas administradas por RPC; nenhum TRUNCATE/DELETE; credenciais e limites sem grants a clientes | A Data API não oferece endpoint TRUNCATE; o privilégio ainda assim era desnecessário. Funções definer intencionais precisam revisão contínua; `search_path` vazio e guardas explícitas |
| 6. SQL injection | SQL parametrizado/RPC, sem SQL dinâmico com texto do cliente; textos não são concatenados como comandos | Não equivale a pentest de todos os endpoints |
| 7. Dispositivos | Prova aleatória 256 bits, apenas hash no banco; proprietário, revogação e confirmação exigidos | Web armazena prova em localStorage: XSS comprometeria sessão/prova; Android usa SecureStore |
| 8. Vínculo e replay | Nonce aleatório, hash persistido, expiração 5 min, uso único, mesma conta e aprovação na origem | Não compartilhar QR/código; recuperação da perda de todos os dispositivos exige fluxo adicional, não bypass automático |
| 9. Concorrência/limite | Lock por usuário serializa bootstrap/aprovação/revogação; sexto dispositivo negado; último não pode ser removido | Testes sequenciais passaram; carga concorrente extensa não executada |
| 10. XSS/clickjacking | React escapa texto; CSP por nonce, frame DENY, nosniff, sem `unsafe-eval` em produção | CSS inline permitido pela implementação; não há promessa de invulnerabilidade |
| 11. CSRF/payload/abuso | APIs exigem bearer/prova, JSON e corpo limitado a 8 KB; testes de content-type/tamanho; cotas em banco | Rate limiting por usuário não substitui proteção contra DDoS nem cotas do provedor |
| 12. Transporte/cache/portas | HTTPS/HSTS e no-store; desenvolvimento alterado para bind 127.0.0.1 | Nenhum servidor EXA escutando publicamente no diagnóstico local; portas da infraestrutura compartilhada não foram escaneadas |
| 13. Dependências | Vitest atualizado a 4.1.11, removendo achados críticos antigos; testes e tipos passam | Restam 4 achados transitivos no tooling Expo: uuid (moderado), node-forge/braces (altos sem patch publicado no audit), sprintf-js (moderado sem patch). Não é auditoria limpa |
| 14. Supply chain/APK | Actions fixadas por SHA, EXPO_TOKEN apenas secret; APK com verificação de assinatura, pacote, ARM64 e zipalign na pipeline | Novo APK precisa concluir EAS e instalação física. Manter keystore existente; incremento automático de versionCode |
| 15. Escopo financeiro | Contas e salário são registrados manualmente; nenhuma senha bancária é coletada | Open Finance foi retirado do escopo desta versão a pedido do proprietário |

## Sincronização

Postgres Changes não envia os headers REST de prova de dispositivo usados pelas políticas. **Não removemos a proteção para fazer o Realtime funcionar.** A V1 usa reconciliação autenticada a cada 15 segundos enquanto visível/ativa e ao retomar/reconectar, além de atualizar após gravações. Não prometer eventos instantâneos. Uma evolução precisa de canais privados autorizados ou associação segura entre sessão Auth e dispositivo, com testes próprios. Sem fila offline de escrita: falhas devem ser apresentadas, não mostradas como gravação bem-sucedida.

## Evidências reproduzíveis

- `pnpm test`: 14 testes passaram (domínio e parsing limitado de requisições).
- `pnpm typecheck`: domínio, web e Android.
- `pnpm build`: Next.js, incluindo `/auth/confirm` e `/auth/callback`.
- `pnpm --filter @exa/mobile exec expo export --platform android`: bundle Hermes.
- `supabase/tests/device_security.sql`: fixtures sintéticas em transação desfeita; verificação, gravação/leitura, isolamento, credenciais inválidas, vínculo, replay, cinco dispositivos e revogação. Executado no schema publicado, sem preservar dados de teste.
- `pnpm audit`: repetir; resultados dependem da base de advisories do dia. Não usar `audit --fix --force` indiscriminadamente.

## Android: diagnóstico seguro do S24 FE

1. Baixar o artefato da execução concluída e extrair o ZIP. Instalar o **APK**, não o ZIP/AAB.
2. Comparar SHA-256 com o arquivo distribuído junto ao APK.
3. Não desativar indiscriminadamente Play Protect/Auto Blocker. Registrar a mensagem exata do instalador e verificar espaço livre.
4. Se continuar travando, com Android Platform Tools oficial e depuração USB autorizada pelo dono: `adb devices`, depois `adb install -r EXA-Android.apk`. Compartilhar somente o código de erro `INSTALL_FAILED_*`, sem dump completo de logs pessoais.
5. Não desinstalar uma versão existente para contornar conflito de assinatura sem preservar dados/acesso. O build deve reutilizar a mesma keystore.

Artefato antigo inspecionado: 80.680.521 bytes, SHA-256 `2e5a73f0303f2246eb9fe33d620c036064bb9f7fd23a08ee199d63fd5e486701`. Não confundir com o APK recompilado.

Novo APK EAS: build `887973d7-25dc-4794-8f68-82d3050a0b79`, workflow GitHub `38263007818` concluído com sucesso. A pipeline verificou assinatura, nome do pacote, ARM64 e alinhamento de 16 KB. O arquivo extraído tem 80.688.633 bytes e SHA-256 `c762e426185c388a41ef22829b5004addbfef743ac5a0574f5e6f28598b79a71`, conferido localmente contra o manifesto do artefato. Instalação física ainda não confirmada.

## Fontes primárias

- OWASP ASVS: https://owasp.org/www-project-application-security-verification-standard/
- Supabase redirects: https://supabase.com/docs/guides/auth/redirect-urls
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Android 16 KB: https://developer.android.com/guide/practices/page-sizes
- Android assinatura: https://developer.android.com/tools/apksigner

Status de publicação e instalação deve ser verificado separadamente. Testes locais e SQL não provam implantação nem funcionamento no aparelho físico.
