import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Stack, usePathname, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { BricolageGrotesque_700Bold } from '@expo-google-fonts/bricolage-grotesque';
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
} from '@expo-google-fonts/dm-sans';
import { DMMono_400Regular, DMMono_500Medium } from '@expo-google-fonts/dm-mono';
import AppHeader, { APP_HEADER_RESERVED_HEIGHT } from '../components/ui/AppHeader';
import { me, isLoggedIn } from '../lib/api/auth';
import { getVerificationStatus, getDashboardStats } from '../lib/api/business';
import { notificationsApi } from '../lib/api/notifications';
import { mapViewerBusiness } from '../lib/api/mappers';
import type { Business } from '../lib/types';

SplashScreen.preventAutoHideAsync();

/** Pre-login screens carry no chrome: the landing page (`/`, wherever it ends up living),
 *  the login/register screen, anything under onboarding, and the entire admin area —
 *  admin has its own login and its own review-queue UI, and should never render the
 *  regular business AppHeader (which is built around a logged-in business viewer, not
 *  an admin). */
function isPreLoginRoute(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/onboarding') ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/auth-callback') ||
    pathname.startsWith('/complete-profile')
  );
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    BricolageGrotesque_700Bold,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMMono_400Regular,
    DMMono_500Medium,
  });
  const pathname = usePathname();
  const router = useRouter();
  const [viewer, setViewer] = useState<Business | null>(null);
  const [alertCount, setAlertCount] = useState(0);

  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync();
  }, [loaded, error]);

  // Real logged-in business, not a placeholder — refetched on every route
  // change so the header updates right after login/logout without needing
  // a full page reload. Skipped entirely on pre-login/admin routes, and
  // silently left null if the call fails (expired token, or an account
  // that hasn't finished onboarding yet) rather than showing stale/fake data.
  useEffect(() => {
    if (isPreLoginRoute(pathname) || !isLoggedIn()) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [user, verification, stats] = await Promise.all([
          me(),
          getVerificationStatus(),
          getDashboardStats(),
        ]);
        // A Google sign-up that never finished setting a mobile number — every
        // other screen assumes one exists (contact display, admin roster, etc.),
        // so this is required before anything else, not a skippable step.
        if (!cancelled && !user.mobile_number) {
          router.replace('/complete-profile');
          return;
        }
        if (!cancelled) setViewer(mapViewerBusiness(user, verification, stats));
      } catch {
        if (!cancelled) setViewer(null);
      }
      // Fetched separately so a notifications-endpoint hiccup never blanks the header
      // itself — worst case the bell badge is just stale/zero for this route change.
      try {
        const notifications = await notificationsApi.listMine();
        if (!cancelled) setAlertCount(notifications.filter((n) => !n.read).length);
      } catch {
        if (!cancelled) setAlertCount(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  if (!loaded && !error) return null;

  const headerShown = !isPreLoginRoute(pathname) && !!viewer;

  return (
    <View style={{ flex: 1 }}>
      {headerShown && <AppHeader viewer={viewer ?? undefined} alertCount={alertCount} />}
      {/* The header floats via position: absolute (AppHeader.tsx) so it can condense over
       *  content while scrolling — this reserves its expanded height so page content
       *  starts below it instead of sliding under it. */}
      <View style={{ flex: 1, paddingTop: headerShown ? APP_HEADER_RESERVED_HEIGHT : 0 }}>
        <Stack screenOptions={{ headerShown: false }} />
      </View>
    </View>
  );
}