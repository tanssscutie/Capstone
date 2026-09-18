// lib/api/requirementsCache.ts
//
// A lightweight memoization layer in front of GET /requirements/{id} — list
// screens (Home, My Requirements) already have a requirement's full detail
// the moment they fetch their list, so `put`/`putMany` lets a click straight
// into Requirement Detail render instantly instead of waiting on a redundant
// network round trip. `ensure()` falls back to the real single-requirement
// endpoint for anything not already cached (e.g. the route was opened
// directly, or the requirement was never open/theirs, and so was never in
// any list this session — closed/awarded requirements owned by someone else
// are now reachable too, which the old list-refetch workaround could never do).
import type { RequirementOut } from './requirements';
import { requirementsApi } from './requirements';

const cache = new Map<number, RequirementOut>();

export const requirementsCache = {
  put(r: RequirementOut) {
    cache.set(r.id, r);
  },
  putMany(items: RequirementOut[]) {
    items.forEach((r) => cache.set(r.id, r));
  },
  get(id: number): RequirementOut | undefined {
    return cache.get(id);
  },
  /** Returns the cached requirement, fetching it directly if it isn't there yet. */
  async ensure(id: number): Promise<RequirementOut | undefined> {
    const hit = cache.get(id);
    if (hit) return hit;
    try {
      const fresh = await requirementsApi.getById(id);
      requirementsCache.put(fresh);
    } catch {
      // swallow — caller decides how to handle a still-missing requirement
    }
    return cache.get(id);
  },
};
