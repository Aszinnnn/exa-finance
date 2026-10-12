export function OpenFinanceStatus() {
  return <section className="panel" style={{ marginBottom: 20 }} aria-labelledby="open-finance-title">
    <div className="panelTitle"><div><h2 id="open-finance-title">Open Finance</h2><p>Conexão bancária ainda não habilitada</p></div></div>
    <p>Para importar contas, saldos e entradas, é necessário configurar um provedor e autorizar o compartilhamento no banco. O EXA nunca deve receber sua senha bancária.</p>
    <p className="hint">Nubank, PicPay, Banco do Brasil, Santander, Itaú e Bradesco: a disponibilidade de cada instituição precisa ser confirmada com o provedor. Nenhum banco está conectado neste momento.</p>
    <p className="hint">Enquanto isso, registre suas contas e seu salário como receita manual. Valores como 100 e 100,50 são aceitos. Salário recebido é uma entrada na conta, não um pagamento de fatura.</p>
  </section>;
}
