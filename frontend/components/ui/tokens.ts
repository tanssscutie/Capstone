// components/ui/tokens.ts
// Extracted from the Claude Design screens. Sizes raised for mobile legibility.
// No new colours or fonts without a PR seen by all four.

export const color = {
  // Text
  ink: '#0F0F0E',
  inkMuted: 'rgba(15,15,14,0.62)',
  inkFaint: 'rgba(15,15,14,0.45)',

  // Navy — actions, verified, sealed
  primary: '#164E78',
  primaryPressed: '#103A5A',
  primaryFaint: 'rgba(22,78,120,0.08)',
  primaryBorder: 'rgba(22,78,120,0.35)',

  // Red — flagged, system events, destructive
  danger: '#B4331F',
  dangerFaint: 'rgba(180,51,31,0.05)',
  dangerBorder: 'rgba(180,51,31,0.35)',

  // Accents — status and highlights (profile tiles, section chips). Approved for
  // the defense build; use sparingly, never for actions (actions stay primary).
  success: '#2F7A4D',
  successFaint: 'rgba(47,122,77,0.08)',
  successBorder: 'rgba(47,122,77,0.35)',
  warning: '#A86512',
  warningFaint: 'rgba(168,101,18,0.08)',
  warningBorder: 'rgba(168,101,18,0.35)',
  accent: '#0F766E',
  accentFaint: 'rgba(15,118,110,0.08)',
  accentBorder: 'rgba(15,118,110,0.35)',

  // Surfaces
  canvas: '#FBFAF9',
  surface: '#FFFFFF',
  surfaceSunken: '#F4F3F0',

  // Lines
  border: 'rgba(15,15,14,0.12)',
  borderFaint: 'rgba(15,15,14,0.09)',
  borderStrong: 'rgba(15,15,14,0.24)',

  onPrimary: '#FFFFFF',
} as const;

/** Every weight is a separate file in React Native. No font-weight: 500. */
export const font = {
  display: 'BricolageGrotesque_700Bold',
  body: 'DMSans_400Regular',
  bodyMedium: 'DMSans_500Medium',
  bodySemi: 'DMSans_600SemiBold',
  mono: 'DMMono_400Regular',
  monoMedium: 'DMMono_500Medium',
} as const;

/** Raised from the web design. 11 is the floor — nothing smaller ships. */
export const fontSize = {
  micro: 11,   // was 9.5 — mono labels
  sm: 13,      // was 11.5
  base: 15,    // was 13 / 13.5 — body
  md: 17,      // was 15
  lg: 20,      // was 17
  xl: 24,      // was 21
  display: 30, // was clamp(25,36)
} as const;

export const lineHeight = {
  micro: 16,
  sm: 18,
  base: 22,
  md: 24,
  lg: 26,
  xl: 30,
  display: 34,
} as const;

/** React Native uses px, not em. Converted at the size each is used. */
export const letterSpacing = {
  label: 2,      // 0.18em on 11px mono
  labelWide: 2.2,
  tight: -0.5,   // -0.03em on headings
  normal: 0,
} as const;

/** 4pt grid. The design used 6, 7, 9, 11 — those were drift, not intent. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  section: 40,
} as const;

export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  pill: 999,
} as const;

/** Web design used box-shadow. Borders read better on device and cost nothing. */
export const elevation = {
  card: {
    borderWidth: 1,
    borderColor: color.borderFaint,
  },
  cardRaised: {
    borderWidth: 1,
    borderColor: color.border,
  },
} as const;

/** Phone-width on every platform. One layout, three targets. */
export const layout = {
  maxWidth: 480,
  /** Every wide page and the header share one centred column (LinkedIn-style),
   *  so content lines up under the nav instead of stretching to the window edges. */
  maxWidthShell: 1180,
  maxWidthWide: 1180,
  /** Three-column dashboard screens (e.g. the home feed) — same centred width as
   *  everything else; the columns compress inside it. */
  maxWidthDashboard: 1180,
  screenPadding: 20,
  minTouchTarget: 44,
  sideColumnMinWidth: 270,
  factMinWidth: 160,
} as const;

/** Below this, single-column phone layout. At and above, two-column wide layout. */
export const breakpoint = {
  desktop: 900,
} as const;