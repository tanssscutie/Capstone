// app/auth-callback.tsx
// Where the backend's /auth/google/callback sends the browser after a Google
// sign-in succeeds — token in the URL, same as a normal login's token, just
// arriving via a redirect instead of a fetch response. Stores it, then routes
// to /complete-profile (fresh Google sign-up, no mobile number or buyer/seller
// choice yet) or /home.
import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { tokenStore } from '../lib/api/client';
import { color } from '../components/ui/tokens';

export default function AuthCallbackRoute() {
  const router = useRouter();
  const { token, needsProfile } = useLocalSearchParams<{ token?: string; needsProfile?: string }>();

  useEffect(() => {
    if (typeof token !== 'string' || !token) {
      router.replace('/login?googleError=Sign-in did not complete. Please try again.');
      return;
    }
    tokenStore.set(token);
    router.replace(needsProfile === 'true' ? '/complete-profile' : '/home');
  }, [token, needsProfile]);

  return (
    <View style={{ flex: 1, backgroundColor: color.canvas, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={color.primary} />
    </View>
  );
}
