// lib/postRequirementClone.ts
// One-shot handoff for "Use Previous Requirement" (HomeFeed's CtaBanner): the
// Home route reads the viewer's own most recent requirement, seeds this
// holder with a re-editable draft, then navigates to /post-requirement, which
// consumes it once on mount. Same idea as pickedRequirementFiles/etc. in
// PostRequirement.tsx — a plain module-level value, since only one clone can
// be in flight at a time (a real route param would need to serialize a
// SpecRow[] through the URL, which isn't worth it for a same-session handoff).
import type { RequirementDetailsDraft, RequirementDeliveryDraft } from '../features/post-requirement/PostRequirement';

let source: {
  details: RequirementDetailsDraft;
  delivery: Pick<RequirementDeliveryDraft, 'city' | 'address'>;
} | null = null;

export const postRequirementClone = {
  set(details: RequirementDetailsDraft, delivery: Pick<RequirementDeliveryDraft, 'city' | 'address'>) {
    source = { details, delivery };
  },
  /** Consumed once — a second read (e.g. the route remounting later) gets nothing. */
  take() {
    const s = source;
    source = null;
    return s;
  },
};
