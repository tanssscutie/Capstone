// lib/api/requirementsCache.ts
//
// The backend has no `GET /requirements/{id}` — only list endpoints
// (`/requirements`, `/requirements/mine`) and action endpoints that take an id.
// Screens that need a single requirement's full detail (app/requirement.tsx,
// app/submit-quotation.tsx) read it from this cache instead, which is filled in
// whenever a list is fetched (home feed) or a requirement is just created
// (post-requirement). If a screen is opened directly with an id that was never
// listed in this session, `ensure()` refetches the lists once to try to fill it.
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
  /** Returns the cached requirement, refetching the open + mine lists once if
   *  it isn't there yet (e.g. the app was opened directly on this route). */
  async ensure(id: number): Promise<RequirementOut | undefined> {
    const hit = cache.get(id);
    if (hit) return hit;
    try {
      const [open, mine] = await Promise.all([requirementsApi.listOpen(), requirementsApi.listMine()]);
      // /requirements/mine returns the lighter MyRequirementOut shape, not
      // RequirementOut, so only `open` can actually refill this cache.
      requirementsCache.putMany(open);
      void mine;
    } catch {
      // swallow — caller decides how to handle a still-missing requirement
    }
    return cache.get(id);
  },
};
