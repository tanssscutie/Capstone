// app/_sitemap.tsx
// Replaces Expo Router's built-in /_sitemap, which lists every route —
// including the admin console's unguessable path. Shows the 404 page instead.
export { default } from './+not-found';
