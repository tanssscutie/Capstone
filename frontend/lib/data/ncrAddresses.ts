// lib/data/ncrAddresses.ts
// Metro Manila city -> barangays -> ZIP codes for the delivery address form,
// from GET /meta/ncr-addresses (backend/app/core/addresses.py) — fetched once
// per app session, no second copy kept here.
//
// A barangay carries a `zip` only when the data is sure of it; otherwise the
// form offers the city's own ZIP list. See the backend module for sources.
import { useEffect, useState } from 'react';
import { listNcrAddresses, type NcrCityAddressesOut } from '../api/meta';

let cached: Record<string, NcrCityAddressesOut> | null = null;
let inflight: Promise<Record<string, NcrCityAddressesOut>> | null = null;

function load(): Promise<Record<string, NcrCityAddressesOut>> {
  if (cached) return Promise.resolve(cached);
  inflight ??= listNcrAddresses()
    .then((rows) => {
      cached = Object.fromEntries(rows.map((r) => [r.city, r]));
      return cached;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function useNcrAddresses(): { byCity: Record<string, NcrCityAddressesOut>; error: boolean } {
  const [byCity, setByCity] = useState(cached ?? {});
  const [error, setError] = useState(false);
  useEffect(() => {
    if (cached) return;
    let alive = true;
    load()
      .then((d) => { if (alive) setByCity(d); })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, []);
  return { byCity, error };
}

/** Case- and accent-insensitive, so "paranaque" / "santo nino" still find matches. */
export function foldName(s: string): string {
  return s.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

/** "San Antonio" -> "Brgy. San Antonio"; numbered ones ("Barangay 12") stay as-is.
 *  Same as barangay_label() in backend/app/core/addresses.py. */
export function barangayLabel(name: string): string {
  return /^(barangay|brgy)/i.test(name) ? name : `Brgy. ${name}`;
}
