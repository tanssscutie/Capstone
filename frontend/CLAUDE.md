# TrustLink

Capstone project. React Native + Expo, one codebase for iOS, Android, and web.

## Read before writing any component

- `components/ui/tokens.ts` — all colours, fonts, spacing, radii
- `lib/types/index.ts` — shared types, the single source of truth
- `docs/design/` — the source designs, exported HTML

## Hard rules

- Only values from `tokens.ts`. No raw hex, no new fonts, no font-weight numbers.
- Use types as they are. Do not add fields. If something is missing, stop and say so.
- Never localStorage or sessionStorage. React state only.
- Multiple states go in one component behind a prop, never separate screens.
- Mock data lives in each feature's folder, in `mock.ts`.
- `npx tsc --noEmit` must pass before you finish.
- If the design has icons, build them from simple shapes. There is no icon library.
- Widths: dashboard-style screens use `layout.maxWidthDashboard`, two-column reading screens use `layout.maxWidthWide`.

## Structure

- `app/` — expo-router routes, thin wrappers only
- `features/<name>/` — one folder per screen
- `components/ui/` — shared primitives, only after a second use
- `lib/types/` — shared types
- `lib/api/` — backend calls, later

## Responsive

Phone stack below `breakpoint.desktop` (900). The design's wide layout at or above it.
See `RequirementDetail.tsx` for the established pattern.

## Sealed quotation rule

Quotation contents are invisible until the closing timestamp. The owner-sealed state
shows a count and a countdown — no identities, no figures, no partial hints, no previews.
Never pass quotation data into a sealed state.

## Never

- Do not show an aggregate quotation price range anywhere.
- Do not build prototype state-switcher tabs from the designs — those are not product.