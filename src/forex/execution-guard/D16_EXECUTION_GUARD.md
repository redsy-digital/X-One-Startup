# D16 — Forex Execution Guard V1

## Objetivo

D16 é a última barreira de segurança entre uma Proposal válida da D15 e o executor D17.

Ela não:
- escolhe CALL/PUT;
- calcula sinais;
- altera stake;
- chama `buy`;
- substitui o Decision Engine;
- transforma `WATCH` do calendário em autorização.

Ela apenas responde se o contexto aprovado continua executável no instante imediatamente anterior ao D17.

## Gates

Ordem atual:

1. Bot em execução
2. Conexão Deriv disponível
3. Nenhuma execução concorrente
4. Decision Engine em `PROPOSAL_CHECK`
5. Direção CALL/PUT válida
6. Decisão dentro da janela de frescor
7. Proposal com ID
8. Proposal dentro da janela de frescor
9. `ask_price` numérico e positivo
10. Parâmetros da Proposal compatíveis com Forex V1
11. Mercado aberto
12. Símbolo da decisão e Proposal coincidentes
13. Calendário presente e fresco
14. Calendário não pode estar BLOCK/COOLDOWN/UNKNOWN/WATCH
15. Risk Engine continua autorizando
16. Nenhuma posição Forex aberta

Somente quando todos passam o resultado é `EXECUTION_AUTHORIZED`.

## Limites de segurança configuráveis

Os valores padrão são limites de engenharia para impedir que contexto velho seja executado:

- decisão: 180 segundos;
- Proposal: 15 segundos;
- calendário: 120 segundos.

Eles não são parâmetros preditivos e não devem ser interpretados como resultado de backtest.

## Próxima fase

D17 — Trade Executor. O executor deve aceitar somente uma autorização D16 válida e executar a operação através do gateway Deriv. D16 permanece sem qualquer chamada a `buy`.
