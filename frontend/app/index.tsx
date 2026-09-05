// app/index.tsx
// Was a static "Fonts and tokens are wired up" splash. Now the real entry point:
// checks whether a token is stored, and if so where onboarding left off, before
// deciding whether to land on /login, /onboarding, or /home.
import { useEffect, useState } from 'react';
import { View, Text, Image, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { color, font, fontSize, space, radius } from '../components/ui/tokens';
import { isLoggedIn, logout } from '../lib/api/auth';
import { getVerificationStatus } from '../lib/api/business';

export default function Index() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    (async () => {
      if (!isLoggedIn()) {
        router.replace('/login');
        return;
      }
      try {
        const status = await getVerificationStatus();
        router.replace(status.onboarding_completed ? '/home' : '/onboarding');
      } catch {
        // Stored token is stale/invalid — send back to login rather than
        // getting stuck on a screen that will just 401 on every call.
        logout();
        router.replace('/login');
      } finally {
        setChecking(false);
      }
    })();
  }, []);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: color.canvas,
        alignItems: 'center',
        justifyContent: 'center',
        gap: space.md,
      }}
    >
      <Image
        source={require('../assets/logo.jpg')}
        style={{ width: 56, height: 56, borderRadius: radius.pill }}
        resizeMode="contain"
      />
      <Text style={{ fontFamily: font.display, fontSize: fontSize.display, color: color.ink }}>TrustLink</Text>
      {checking && <ActivityIndicator color={color.primary} />}
    </View>
  );
}
