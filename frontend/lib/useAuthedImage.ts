// lib/useAuthedImage.ts
// Loads an image that sits behind the login (profile picture, cover photo) as a
// blob: URL. Null while loading, when there's no path, or when it 404s — the
// caller shows its fallback (initials, gradient). Bump `version` to reload
// after an upload.
import { useEffect, useState } from 'react';
import { fetchAuthedBlobUrl } from './api/client';

export function useAuthedImage(path: string | null, version = 0): string | null {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    setUri(null);
    if (!path || typeof URL === 'undefined' || !URL.createObjectURL) return;
    let url: string | null = null;
    let alive = true;
    fetchAuthedBlobUrl(path)
      .then((u) => { url = u; if (alive) setUri(u); else URL.revokeObjectURL(u); })
      .catch(() => undefined);
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [path, version]);
  return uri;
}
