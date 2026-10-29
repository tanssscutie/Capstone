// lib/api/meta.ts
// GET /meta/categories — the category → item → spec tree from
// backend/app/core/categories.py, each item's specs already merged
// General → Category → Item. Public (no token): the register form needs it.
import { api } from './client';

export interface ItemSpecOut {
  /** Attribute id from the shared dictionary (GET /meta/attributes). */
  id: string;
  label: string;
  type: 'text' | 'number' | 'select';
  options: string[];
  unit: string | null;
  required: boolean;
  /** Offers "Not sure — supplier to recommend" (SUPPLIER_TO_RECOMMEND). */
  can_recommend: boolean;
  /** Guessed, pending review. */
  draft: boolean;
}

export interface CategoryItemOut {
  code: string;
  name: string;
  specs: ItemSpecOut[];
}

export interface CategoryOut {
  name: string;
  items: CategoryItemOut[];
}

export interface SpecSuggestionOut {
  attribute_id: string | null;
  label: string | null;
  unit: string | null;
  score: number | null;
}

export interface NcrCityAddressesOut {
  city: string;
  zips: { zip: string; area: string }[];
  /** `zip` only when the data is sure of it. */
  barangays: { name: string; zip: string | null }[];
}

/** GET /meta/ncr-addresses — public, like the category list. */
export async function listNcrAddresses(): Promise<NcrCityAddressesOut[]> {
  return api.get<NcrCityAddressesOut[]>('/meta/ncr-addresses', { auth: false });
}

export async function listCategories(): Promise<CategoryOut[]> {
  return api.get<CategoryOut[]>('/meta/categories', { auth: false });
}

/** POST /meta/suggest-attribute — "Did you mean …?" for a buyer's own spec row
 *  label. A hint only: null fields when nothing is close enough. */
export async function suggestAttribute(label: string, category: string, itemCode: string): Promise<SpecSuggestionOut> {
  return api.post<SpecSuggestionOut>('/meta/suggest-attribute', { label, category, item_code: itemCode || null });
}

/** GET /meta/banner — the maintenance banner a super admin set; empty when none. */
export async function getMaintenanceBanner(): Promise<string> {
  const r = await api.get<{ message: string }>('/meta/banner', { auth: false });
  return r.message ?? '';
}
