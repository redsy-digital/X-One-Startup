# D19 Runtime Integration

Integra o pipeline Forex operacional sem fabricar sinais:

`D13 Decision -> D15 Proposal -> D16 Execution Guard -> D17 Executor -> D19 Demo`.

O Direction Engine continua em fail-closed enquanto não houver pesos/features explicitamente promovidos pelo protocolo de pesquisa. Portanto, `WAIT_SIGNAL` é um estado válido e não deve ser contornado para forçar um BUY.

O BUY só é alcançado quando D13 retorna `PROPOSAL_CHECK`, D15 devolve Proposal válida, D16 devolve `EXECUTION_AUTHORIZED` e a conta está explicitamente identificada como Demo.
