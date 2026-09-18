// lib/data/categories.ts
// The 10 categories the study scopes procurement to (thesis Scope and
// Delimitation — Supported Categories). Single source of truth — Onboarding.tsx
// (business's own industry category) and PostRequirement.tsx (a requirement's
// category) both read from this, so the two lists can't drift apart again like
// they did before this file existed. "IT" here is equipment/hardware
// procurement only, never software development.
export const CATEGORIES: string[] = [
  'Printing',
  'Construction Supply',
  'Fabrication & Manufacturing',
  'Industrial Services',
  'Food Supply & Catering',
  'Medical & Clinic Supplies',
  'IT Equipment & Hardware',
  'Vehicle Parts & Services',
  'Packaging & Labeling',
  'Office & Janitorial Supplies',
];
