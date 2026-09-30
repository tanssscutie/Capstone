// lib/data/categories.ts
// The 2 categories the study scopes procurement to (thesis Scope and
// Delimitation — Supported Categories). Single source of truth — Onboarding.tsx
// (business's own industry category) and PostRequirement.tsx (a requirement's
// category) both read from this, so the two lists can't drift apart again like
// they did before this file existed.
export const CATEGORIES: string[] = [
  'Printing',
  'Packaging & Labeling',
];
