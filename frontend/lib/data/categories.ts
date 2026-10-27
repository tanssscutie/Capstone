// lib/data/categories.ts
// The 2 categories the study scopes procurement to (thesis Scope and
// Delimitation — Supported Categories), with each category's items and their
// specs (merged General → Category → Item on the backend). The tree lives in
// backend/app/core/categories.py and is fetched once from GET /meta/categories —
// login.tsx (registration), Onboarding.tsx and PostRequirement.tsx all read it
// through useCategoryTree(), so there is no second copy here to drift out of sync.
import { useEffect, useState } from 'react';
import { listCategories } from '../api/meta';
import type { CategoryOut, CategoryItemOut, ItemSpecOut } from '../api/meta';
import type { SpecRow } from '../types';

export type CategoryNode = CategoryOut;
export type CategoryItem = CategoryItemOut;
export type SpecTemplate = ItemSpecOut;

/** Every category's last item — general + category specs only. */
export const OTHER_ITEM_CODE = 'other';

/** General specs that are the requirement's Quantity field ("500 pcs"), not
 *  spec rows. Same as QUANTITY_ATTRIBUTE_IDS in backend/app/core/categories.py. */
export const QUANTITY_ATTRIBUTE_IDS = ['quantity', 'unit'];

/** Shown to sellers as "<brand> (or equivalent)"; never used for matching. */
export const PREFERRED_BRAND_ID = 'preferred_brand';

let cached: CategoryNode[] | null = null;
let inFlight: Promise<CategoryNode[]> | null = null;

function loadTree(): Promise<CategoryNode[]> {
  if (cached) return Promise.resolve(cached);
  if (!inFlight) {
    inFlight = listCategories()
      .then((tree) => (cached = tree))
      // Let the next caller retry instead of caching the failure.
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

/** The category tree, fetched once per app session. Empty while loading;
 *  `error` is set if the fetch failed. */
export function useCategoryTree(): { tree: CategoryNode[]; categories: string[]; loading: boolean; error: boolean } {
  const [tree, setTree] = useState<CategoryNode[]>(cached ?? []);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (cached) return;
    let alive = true;
    loadTree()
      .then((t) => { if (alive) setTree(t); })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, []);
  return { tree, categories: tree.map((c) => c.name), loading: tree.length === 0 && !error, error };
}

export function itemsFor(tree: CategoryNode[], category: string): CategoryItem[] {
  return tree.find((c) => c.name === category)?.items ?? [];
}

export function findItem(tree: CategoryNode[], category: string, code: string | null | undefined): CategoryItem | undefined {
  return code ? itemsFor(tree, category).find((i) => i.code === code) : undefined;
}

/** The label a spec is stored under — unit folded in, e.g. "Size (ft)".
 *  Same as spec_label() in backend/app/core/categories.py. */
export function specLabel(spec: { label: string; unit: string | null }): string {
  return spec.unit ? `${spec.label} (${spec.unit})` : spec.label;
}

/** Plain non-negative decimal, commas allowed ("1,000", "2.5").
 *  Same rule as is_number() in backend/app/core/categories.py. */
export function isNumber(value: string): boolean {
  return /^\d+(\.\d+)?$/.test(value.replace(/,/g, '').trim());
}

/** "500 pcs" → { number: "500", unit: "pcs" }. number is "" when the text
 *  doesn't start with one. Same as split_quantity() on the backend. */
export function splitQuantity(quantity: string): { number: string; unit: string } {
  const m = /^\s*([\d,]+(?:\.\d+)?)\s*(.*)$/.exec(quantity ?? '');
  return m ? { number: m[1], unit: m[2].trim() } : { number: '', unit: (quantity ?? '').trim() };
}

/** A spec value as a seller should read it: the preferred brand always
 *  carries "(or equivalent)" so it never reads as a hard requirement. */
export function specDisplayValue(row: SpecRow): string {
  return row.attributeId === PREFERRED_BRAND_ID ? `${row.value} (or equivalent)` : row.value;
}

/** First problem with a requirement's item + spec rows + quantity, or null.
 *  Same rules and wording as validate_item_specs() in backend/app/core/categories.py. */
export function itemSpecError(
  tree: CategoryNode[],
  category: string,
  itemCode: string,
  rows: SpecRow[],
  quantity: string,
): string | null {
  const item = findItem(tree, category, itemCode);
  if (!item) return `Pick an item from ${category}.`;
  const byId = new Map(rows.filter((r) => r.attributeId).map((r) => [r.attributeId!, r.value.trim()]));
  const byLabel = new Map(rows.map((r) => [r.label.trim(), r.value.trim()]));
  const qty = splitQuantity(quantity);
  for (const spec of item.specs) {
    const label = specLabel(spec);
    let value: string;
    if (spec.id === 'quantity') value = quantity.trim() ? qty.number || quantity.trim() : '';
    else if (spec.id === 'unit') value = qty.unit;
    else value = byId.get(spec.id) || byLabel.get(label) || '';
    if (!value) {
      if (spec.required) return `Add a value for ${label} — it's required for ${item.name}.`;
      continue;
    }
    if (spec.type === 'select' && !spec.options.includes(value)) {
      return `${label} must be one of: ${spec.options.join(', ')}.`;
    }
    if (spec.type === 'number' && !isNumber(value)) {
      return `${label} must be a number.`;
    }
  }
  return null;
}
