# Forex Decision Engine V1 — D1 contract

Esta pasta contém apenas os contratos/interfaces congelados no Dia 1.

## Pipeline

`Market Data → Data Quality → Features → Regime → Direction → Economic Calendar → Contract → Risk → Proposal → Buy`

## Regra de segurança

Nenhuma implementação desta pasta deve executar `buy`. As fases posteriores ligam os ports a implementações reais.

## Deriv New API

A camada de integração existente em `src/lib/deriv.ts` continua sendo a única fronteira com a Deriv. Os ports acima não devem conhecer payloads Legacy. Quando Proposal/Buy forem ligados, usar `underlying_symbol` e o formato atual da New API.
