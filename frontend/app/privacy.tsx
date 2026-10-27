// app/privacy.tsx
// The Privacy Notice (RA 10173). Public: the register form links here before
// anyone has an account, so it carries no header (see isPreLoginRoute).
import { useRouter } from 'expo-router';
import PrivacyNotice from '../features/legal/PrivacyNotice';

export default function PrivacyRoute() {
  const router = useRouter();
  return (
    <PrivacyNotice
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/login'))}
    />
  );
}
