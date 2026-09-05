// app/help.tsx
// "Help & Support" — the account dropdown pointed here with no route file
// behind it (Unmatched Route).
import { useRouter } from 'expo-router';
import HelpSupport from '../features/help/HelpSupport';

export default function HelpRoute() {
  const router = useRouter();
  return <HelpSupport onBack={() => router.push('/home')} />;
}
