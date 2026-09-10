# Forex Economic Calendar — D11

## Objetivo
Implementar a camada de serviço do calendário económico nativo da Deriv sem ligar execução de ordens.

## Fluxo
Deriv New/Public calendar adapter
→ normalizeEconomicEvent()
→ ForexCalendarServiceImpl
→ evaluateForexCalendar()
→ snapshot consumido pelo Decision Engine/Dashboard

## Contrato confirmado no laboratório
A resposta real testada usa:
`economic_calendar.events[]`

Cada evento observado contém:
- `currency`
- `event_name`
- `impact` (escala observada 1–5)
- `release_date` (epoch)
- `actual.display_value`
- `forecast.display_value`
- `previous.display_value`

## D11
O serviço:
- aceita várias moedas;
- consulta cada moeda em paralelo;
- deduplica eventos;
- ordena cronologicamente;
- usa cache curto;
- cria uma janela configurável de passado/futuro;
- devolve snapshot `deriv-native`;
- não executa `proposal` nem `buy`.

Configuração padrão:
- pré-evento: 30 min
- pós-evento: 15 min
- watch medium: 30 min
- medium não bloqueia por padrão
- impacto desconhecido bloqueia
- cache: 60 s
- lookback: 30 min
- lookahead: 180 min

A lógica de bloqueio continua isolada em `engine.ts`; D11 não decide direção nem risco.
