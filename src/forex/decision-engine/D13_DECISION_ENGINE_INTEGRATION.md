# D13 — Forex Decision Engine Integration

## Objetivo

Integrar os snapshots já produzidos pelas fases anteriores num único gate de decisão Forex, sem executar Proposal ou Buy.

## Ordem dos gates

1. Mercado Forex / mercado aberto
2. Freshness dos dados
3. Features presentes
4. Regime presente
5. Direction aprovado
6. Calendário económico
7. Contrato válido e alinhado com CALL/PUT
8. Risco aprovado
9. `PROPOSAL_CHECK`

## Calendário

O calendário continua a ser um filtro de risco, não um gerador de direção.

- `BLOCK` / `COOLDOWN` → `NEWS_BLOCK`
- `UNKNOWN` → fail-closed
- `WATCH` → exige confirmação explícita adicional; D13 não inventa essa confirmação
- `CLEAR` → segue para o próximo gate

## Segurança

D13 não chama `buy`, não chama `proposal` e não altera stake. A saída `PROPOSAL_CHECK` significa apenas que os gates anteriores foram aprovados e a Proposal pode ser validada pela fase seguinte.

## Auditoria

Cada resultado contém `decisionId`, `engineVersion`, timestamp e o contexto dos gates.
