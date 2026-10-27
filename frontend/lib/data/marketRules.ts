// lib/data/marketRules.ts
// The platform rules the UI explains — fetched from GET /meta/rules so the
// numbers always match the server's .env (e.g. a lowered minimum for a demo).
import { useEffect, useState } from 'react';
import { api } from '../api/client';

export interface MarketRules {
  /** Fewest quotations needed at closing to release and award. */
  minQuotations: number;
  /** Days closing is extended, once, when short of the minimum. */
  autoExtendDays: number;
}

const FALLBACK: MarketRules = { minQuotations: 4, autoExtendDays: 3 };
let cached: MarketRules | null = null;

export function useMarketRules(): MarketRules {
  const [rules, setRules] = useState<MarketRules>(cached ?? FALLBACK);
  useEffect(() => {
    if (cached) return;
    let alive = true;
    api.get<{ min_quotations: number; auto_extend_days: number }>('/meta/rules', { auth: false })
      .then((r) => {
        cached = { minQuotations: r.min_quotations, autoExtendDays: r.auto_extend_days };
        if (alive) setRules(cached);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return rules;
}
