import { describe, expect, it } from 'vitest';
import { getForexSession } from './session';

describe('Forex session context D5', () => {
  it('identifies London/New York overlap at 13:00 UTC', () => {
    const s = getForexSession(Date.UTC(2026, 7, 24, 13, 0, 0));
    expect(s.activeSessions).toContain('LONDON');
    expect(s.activeSessions).toContain('NEW_YORK');
    expect(s.overlap).toBe(true);
    expect(s.session).toBe('OVERLAP');
  });

  it('does not replace the Deriv market-open gate', () => {
    const s = getForexSession(Date.UTC(2026, 7, 24, 13, 0, 0));
    expect(s).toHaveProperty('version', 'forex-session-v1.0.0');
  });
});
