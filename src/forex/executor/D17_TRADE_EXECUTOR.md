# D17 — Trade Executor Forex V1

## Objetivo

Executar uma compra na Deriv **somente** quando a D16 tiver produzido `EXECUTION_AUTHORIZED` para a mesma Proposal.

## Regras

- D17 não escolhe CALL/PUT.
- D17 não escolhe duração.
- D17 não altera stake.
- D17 não cria uma nova Proposal.
- D17 não ignora o Execution Guard.
- D17 envia exatamente `buy: proposalId` e `price: proposal.askPrice`.
- Não envia `loginid`: a New API gere a conta através da autorização.
- O sucesso só é confirmado se a resposta da Deriv tiver `buy.contract_id`.
- Falha ou resposta sem `contract_id` nunca é tratada como trade executado.
- Um latch interno impede duas compras concorrentes.

## Fluxo

`D16 EXECUTION_AUTHORIZED → D17 → buy → contract_id → D18`

A implementação não ativa automaticamente o bot nem altera o Dashboard. A execução só ocorre quando o método `execute()` for chamado por uma camada de orquestração que tenha obtido a autorização D16.
