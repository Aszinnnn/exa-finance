# Limitações conhecidas

- **Não é uma V1 integral conforme a especificação original.** O código implementa uma base funcional, mas CSV/OFX, voz, WOL, lembretes e testes de integração ainda faltam. Cartões/faturas existem em código, sem teste em banco real.
- **Revogação sem teste integrado:** RLS e APIs exigem uma credencial por instalação ativa, mas a migration ainda não foi exercitada num Supabase real. A garantia de bloqueio imediato depende desse teste.
- **Sem APK final:** não há Android SDK, JDK, aparelho/emulador nem credenciais EAS neste ambiente. Nenhum APK foi gerado ou instalado.
- **Sem deploy:** faltam projeto Supabase e acesso Vercel fornecidos pelo proprietário.
- **WhatsApp automático:** não foi testado com uma conta Meta real. Templates, política de preço e número emissor precisam de aprovação externa. O tamanho pequeno do projeto não assegura gratuidade. Com política de custo zero, a tentativa potencialmente tarifável é bloqueada.
- **Cron diário:** a rotina de 30 dias depende de deploy na Vercel e de `CRON_SECRET`. Não há agendamento ativo em produção neste momento.
- **Segurança operacional:** foram adicionados CSP com nonce, limites de requisição e payload, integridade de lançamentos e assinatura do webhook; ainda faltam testes de RLS em banco real, auditoria dinâmica e teste de sessão. A chave de dispositivo da web fica no armazenamento local do navegador e continua sujeita a XSS caso a CSP seja contornada. Veja `docs/SEGURANCA.md`.
- **Dependências:** a auditoria de produção ainda aponta 4 avisos transitivos ligados ao toolchain Expo/Metro, sendo 2 altos e 2 moderados. Exigem resolução antes da distribuição do APK.
- **Relatórios:** o PDF inclui lançamentos simples, parcelas e faturas. As contas e faturas ainda não passaram por reconciliação com extratos bancários reais.
- **Conta e saldo:** uma conta sem saldo inicial exibe “não configurado”. Sem histórico completo, não considerar o valor apresentado uma reconciliação bancária.
- **Volume de dados:** o saldo visual é agregado no banco sobre todos os lançamentos; apenas a lista visual mostra os últimos 200. O PDF não é emitido quando uma consulta excede o limite retornado pelo Supabase, evitando um relatório silenciosamente incompleto. Paginação do PDF ainda é necessária.
