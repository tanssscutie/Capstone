// components/ui/HeaderScrollContext.tsx
// Shared Animated.Value so the global AppHeader can react to scroll offset
// pushed in by whichever screen owns the ScrollView.

import { createContext, useContext } from 'react';
import { Animated } from 'react-native';

export const HeaderScrollContext = createContext<Animated.Value | null>(null);

export function useHeaderScroll(): Animated.Value | null {
  return useContext(HeaderScrollContext);
}

/** Threshold (px) of vertical scroll at which the header reaches its
 *  fully condensed state. Tuned for the AppHeader's default padding. */
export const HEADER_CONDENSE_AT = 24;
