# D19 — Demo Trading

## Objetivo

Executar o pipeline Forex em conta Demo da Deriv, sem permitir conta Real, e acompanhar o contrato até a liquidação.

## Regras

1. A conta precisa estar explicitamente autorizada.
2. `isDemo` precisa ser verdadeiro; caso contrário D19 bloqueia antes de `buy`.
3. Proposal ID e preço precisam ser válidos.
4. Não é permitido mais de um buy/contrato ativo pelo executor D19.
5. Só consideramos o buy confirmado quando a Deriv devolve `contract_id`.
6. Após o buy, o contrato é subscrito/monitorizado.
7. Após `isSold`, o contrato deixa de ser considerado ativo.
8. Reconexão não deve gerar outro buy: o `contract_id` existente pode ser recuperado e monitorizado novamente.
9. D19 não contém mecanismo para habilitar conta Real.

## Ciclo

`D13 → D15 → D16 → D17 → D19 → BUY Demo → contract_id → monitor → WIN/LOSS/P&L`

## Fonte da verdade

O estado do contrato deve vir da resposta da Deriv. Queda de WebSocket não deve ser interpretada como WIN ou LOSS.
