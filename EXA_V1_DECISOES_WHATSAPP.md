# EXA V1 — Decisões obrigatórias para relatórios via WhatsApp

**Data da decisão:** 11/10/2026
**Origem:** complemento solicitado para `EXA_V1_ESPECIFICACAO_PARA_CODEX.md`
**Precedência:** este documento substitui os trechos conflitantes da especificação sobre periodicidade e canal de entrega dos relatórios.

## 1. Requisito funcional confirmado

O EXA deve permitir o envio do relatório financeiro em PDF pelo WhatsApp em duas situações:

1. **Envio periódico:** a cada 30 dias, contado a partir da ativação da rotina pelo usuário.
2. **Envio antecipado:** a qualquer momento, quando o usuário solicitar o relatório antes da próxima data agendada.

O envio antecipado não altera automaticamente a próxima data periódica. A interface deve oferecer uma opção separada caso o usuário queira reiniciar a contagem dos 30 dias.

## 2. Regra de período

- O relatório periódico usa os 30 dias completos anteriores ao instante agendado, no fuso `America/Sao_Paulo`.
- O relatório antecipado permite escolher o período. O padrão é o intervalo desde o último relatório até o momento da solicitação.
- O PDF deve exibir claramente as datas inicial e final. Não deve chamar um intervalo móvel de “mês calendário”.
- O fechamento mensal já descrito na especificação pode continuar existindo como opção separada, mas não substitui a rotina de 30 dias.

## 3. Canais de entrega

### 3.1 Compartilhamento manual, sem custo da Meta

Deve estar sempre disponível:

- Android: gerar o PDF e abrir o Sharesheet com MIME `application/pdf`, permitindo ao usuário selecionar o WhatsApp e confirmar o envio.
- Web: baixar o PDF e orientar o usuário a anexá-lo no WhatsApp Web, ou usar compartilhamento nativo quando o navegador suportar arquivos.
- Solicitação antecipada: gerar o PDF imediatamente e abrir o mesmo fluxo de compartilhamento.

Esse fluxo exige confirmação do usuário e não constitui disparo automático em segundo plano.

### 3.2 Envio automático oficial

O envio automático em segundo plano deve usar somente a Meta WhatsApp Business Platform/Cloud API oficial. O recurso depende de:

- conta empresarial e número emissor elegíveis;
- destinatário validado e consentimento registrado;
- credenciais mantidas apenas no servidor;
- template aprovado quando exigido pelas regras vigentes;
- mídia ou link privado temporário conforme as capacidades atuais da API;
- webhooks assinados para conciliar os estados aceito, enviado, entregue, lido e falho.

O sistema não deve usar automação de WhatsApp Web, scraping, bibliotecas não oficiais ou conta pessoal para simular envio automático.

## 4. Política obrigatória de custo zero

“Projeto pequeno” não é critério suficiente para garantir gratuidade da Meta. As regras e tarifas dependem da categoria da mensagem, país, janela de atendimento e política vigente.

Para manter custo efetivo de Meta igual a zero na V1:

- configurar `WHATSAPP_MAX_COST_CENTS=0` por padrão;
- verificar a elegibilidade de custo antes de cada tentativa automática;
- bloquear qualquer envio estimado como tarifável;
- nunca converter o bloqueio em sucesso;
- registrar `blocked_by_zero_cost_policy` e oferecer imediatamente o compartilhamento manual;
- exibir no painel: `Envio automático não realizado para evitar cobrança. PDF pronto para compartilhar pelo WhatsApp.`;
- permitir alteração do limite somente mediante ação explícita do proprietário da conta.

Se a Meta não disponibilizar uma forma confiável de confirmar previamente custo zero, o sistema deve falhar de forma segura e usar o fluxo manual.

## 5. Agendamento e idempotência

Adicionar uma configuração por usuário com, no mínimo:

- `enabled`;
- `interval_days = 30`;
- `timezone = America/Sao_Paulo`;
- `next_delivery_at`;
- `whatsapp_recipient_id` ou número validado;
- `delivery_mode` (`manual` ou `cloud_api`);
- `zero_cost_only = true` por padrão;
- `last_scheduled_delivery_at`;
- `last_successful_delivery_at`.

O cron diário da Vercel consulta rotinas vencidas. Cada execução deve criar um job idempotente com chave única por usuário, intervalo e canal. A próxima data deve avançar a partir da data agendada anterior, não do horário real de execução, para evitar deriva.

Solicitações antecipadas devem usar uma chave de idempotência própria e nunca cancelar, duplicar ou marcar como concluído o job periódico.

## 6. Estados mínimos

- `scheduled`
- `generating`
- `ready_for_share`
- `sending`
- `provider_accepted`
- `delivered`
- `failed`
- `blocked_by_zero_cost_policy`
- `awaiting_manual_share`

`provider_accepted` não equivale a `delivered`.

## 7. Critérios de aceite adicionais

- **AC-WA-01:** ao ativar a rotina, o sistema calcula `next_delivery_at` para 30 dias depois no fuso do usuário.
- **AC-WA-02:** duas execuções do cron não criam dois envios para o mesmo ciclo.
- **AC-WA-03:** uma solicitação antes do prazo gera novo PDF e inicia entrega pelo canal WhatsApp configurado.
- **AC-WA-04:** solicitação antecipada não muda a próxima entrega periódica sem escolha explícita.
- **AC-WA-05:** com `zero_cost_only=true`, tentativa potencialmente tarifável é bloqueada e oferece compartilhamento manual.
- **AC-WA-06:** sem Cloud API configurada, o produto não afirma que enviou automaticamente.
- **AC-WA-07:** PDF temporário recebe `Cache-Control: private, no-store`, acesso autenticado, expiração curta e limpeza posterior.
- **AC-WA-08:** logs não contêm conteúdo financeiro, token, PDF ou número completo do destinatário.
- **AC-WA-09:** status `delivered` só aparece após webhook válido do provedor.

## 8. Ajustes necessários na especificação principal

Na implementação, revisar especialmente:

- tabela da seção 1.1;
- seções 12.3 e 12.4;
- seção 13 completa;
- tabela `monthly_report_jobs` da seção 14;
- rotas `/api/reports/generate`, `/api/reports/share` e `/api/cron/daily`;
- estratégia de notificações da seção 16;
- variáveis de ambiente da seção 17;
- Fase 4 e critérios AC-13, AC-14 e AC-15.

Recomenda-se renomear `monthly_report_jobs` para `report_delivery_jobs`, pois o novo requisito inclui intervalos móveis de 30 dias e solicitações antecipadas.
