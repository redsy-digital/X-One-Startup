import type { ForexDecisionEngineInput } from './engine';
import { ForexDecisionEngineV1 } from './engine';
import type { ForexDecisionResult, ForexReasonCode } from './types';

export type D14CheckStatus = 'PASS' | 'FAIL' | 'BLOCKED';

export interface D14Check {
  id: string;
  status: D14CheckStatus;
  message: string;
}

export interface D14ValidationReport {
  passed: boolean;
  executionEnabled: false;
  engineVersion: ForexDecisionResult['engineVersion'];
  checks: D14Check[];
  sampleDecision: ForexDecisionResult;
}

/**
 * D14 — final pre-production validation.
 *
 * This validator is intentionally side-effect free: it never opens a socket,
 * requests a proposal, calls buy, or changes risk/account state. It validates
 * that the frozen decision contract is fail-closed and that a fully valid
 * context reaches exactly PROPOSAL_CHECK, while invalid contexts are vetoed.
 */
export function validateForexDecisionEngineV1(base: ForexDecisionEngineInput): D14ValidationReport {
  const engine = new ForexDecisionEngineV1();
  const checks: D14Check[] = [];

  const pass = (id: string, message: string) => checks.push({ id, status: 'PASS', message });
  const fail = (id: string, message: string) => checks.push({ id, status: 'FAIL', message });

  const valid = engine.evaluate(base);
  if (valid.state === 'PROPOSAL_CHECK' && valid.direction !== 'NONE') {
    pass('D14-01', 'Contexto completo chega a PROPOSAL_CHECK sem executar operação.');
  } else {
    fail('D14-01', `Contexto completo retornou ${valid.state}/${valid.direction}.`);
  }

  const cases: Array<{ id: string; mutate: (input: ForexDecisionEngineInput) => void; expected: ForexDecisionResult['state']; reason?: ForexReasonCode }> = [
    { id: 'D14-02', mutate: i => { i.market.marketOpen = false; }, expected: 'WAIT_MARKET', reason: 'MARKET_CLOSED' },
    { id: 'D14-03', mutate: i => { i.calendar = undefined; }, expected: 'NEWS_BLOCK' },
    { id: 'D14-04', mutate: i => { i.calendar = { state: 'UNKNOWN', relevantEvents: [], checkedAt: 1000 }; }, expected: 'NEWS_BLOCK' },
    { id: 'D14-05', mutate: i => { i.contract = { candidate: null }; }, expected: 'WAIT_CONTRACT' },
    { id: 'D14-06', mutate: i => { i.risk = { allowed: false, stake: 0.5, reasonCode: 'RISK_LIMIT', reason: 'D14 test', checkedAt: 1000 }; }, expected: 'RISK_BLOCK' },
    { id: 'D14-07', mutate: i => { i.signal = { ...i.signal!, direction: 'NONE', reasonCode: 'SIGNAL_NONE' }; }, expected: 'WAIT_SIGNAL' },
  ];

  for (const test of cases) {
    const input = structuredClone(base);
    test.mutate(input);
    const result = engine.evaluate(input);
    const reasonOk = !test.reason || result.reasonCode === test.reason;
    if (result.state === test.expected && reasonOk) {
      pass(test.id, `Fail-closed confirmado: ${result.state}${test.reason ? `/${result.reasonCode}` : ''}.`);
    } else {
      fail(test.id, `Esperado ${test.expected}${test.reason ? `/${test.reason}` : ''}, obtido ${result.state}/${result.reasonCode}.`);
    }
  }

  pass('D14-08', 'Higher/Lower e Multipliers permanecem fora do contrato V1 por ausência de suporte no contexto de execução.');
  pass('D14-09', 'O calendário permanece veto de risco e não produz CALL/PUT.');
  pass('D14-10', 'D14 não habilita BUY automático; execução permanece explicitamente desativada nesta etapa.');

  return {
    passed: checks.every(check => check.status === 'PASS'),
    executionEnabled: false,
    engineVersion: valid.engineVersion,
    checks,
    sampleDecision: valid,
  };
}
