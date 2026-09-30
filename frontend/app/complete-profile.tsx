// app/complete-profile.tsx
// A Google sign-up lands here once (auth-callback / _layout route here only
// when the backend says the mobile number or the buyer/seller account type is
// still missing). The rest of the app — contact display, which nav and actions
// to show, admin roster, etc. — assumes every business has both, so this is
// required before Home, not a skippable step. Only the missing fields show.
import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, Image, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { color, font, fontSize, space, radius } from '../components/ui/tokens';
import { RolePicker } from '../components/ui/RolePicker';
import { completeProfile, me, type BackendUser } from '../lib/api/auth';
import { errorMessage } from '../lib/api/client';
import type { AccountRole } from '../lib/types';

export default function CompleteProfileRoute() {
  const router = useRouter();
  const [user, setUser] = useState<BackendUser | null>(null);
  const [mobileNumber, setMobileNumber] = useState('');
  const [role, setRole] = useState<AccountRole | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    me()
      .then(setUser)
      .catch(() => router.replace('/login'));
  }, []);

  const needsMobile = !!user && !user.mobile_number;
  const needsRole = !!user && !user.role && !user.is_admin;

  async function handleSubmit() {
    setError(null);
    setLoading(true);
    try {
      await completeProfile({
        mobileNumber: needsMobile ? mobileNumber.trim() : undefined,
        role: needsRole ? role ?? undefined : undefined,
      });
      router.replace('/home');
    } catch (e: any) {
      setError(errorMessage(e, 'Something went wrong. Please try again.'));
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = (!needsMobile || mobileNumber.trim().length >= 7) && (!needsRole || role !== null);

  if (!user) {
    return (
      <View style={styles.screen}>
        <ActivityIndicator color={color.primary} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <View style={styles.brandRow}>
          <Image source={require('../assets/logo.jpg')} style={styles.brandLogo} resizeMode="contain" />
          <Text style={styles.title}>TrustLink</Text>
        </View>
        <Text style={styles.subtitle}>One more step before you continue</Text>
        <Text style={styles.helper}>
          {needsMobile
            ? 'We use your mobile number for contact and account recovery. You can add it once here.'
            : 'Tell us how you will use TrustLink.'}
        </Text>

        {needsRole && <RolePicker value={role} onChange={setRole} />}

        {needsMobile && (
          <View style={styles.field}>
            <Text style={styles.label}>Mobile number</Text>
            <TextInput
              style={styles.input}
              value={mobileNumber}
              onChangeText={setMobileNumber}
              placeholder="+63 917 555 0118"
              placeholderTextColor={color.inkFaint}
              keyboardType="phone-pad"
              autoCapitalize="none"
            />
          </View>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable
          style={[styles.button, (!canSubmit || loading) && styles.buttonDisabled]}
          disabled={!canSubmit || loading}
          onPress={handleSubmit}
        >
          {loading ? <ActivityIndicator color={color.onPrimary} /> : <Text style={styles.buttonLabel}>Continue</Text>}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.canvas, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  card: { width: '100%', maxWidth: 400, backgroundColor: color.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: color.border, padding: space.xxl },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.xs },
  brandLogo: { width: 28, height: 28, borderRadius: radius.pill },
  title: { fontFamily: font.display, fontSize: fontSize.xl, color: color.ink },
  subtitle: { fontFamily: font.body, fontSize: fontSize.base, color: color.ink, marginTop: space.lg },
  helper: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted, marginTop: space.xs, marginBottom: space.xl },
  field: { marginBottom: space.lg },
  label: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.ink, marginBottom: space.xs },
  input: { borderWidth: 1, borderColor: color.border, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.md, fontFamily: font.body, fontSize: fontSize.base, color: color.ink, backgroundColor: color.canvas },
  error: { fontFamily: font.body, fontSize: fontSize.sm, color: color.danger, marginBottom: space.md },
  button: { backgroundColor: color.primary, borderRadius: radius.md, paddingVertical: space.md, alignItems: 'center', marginTop: space.sm },
  buttonDisabled: { opacity: 0.5 },
  buttonLabel: { fontFamily: font.bodySemi, fontSize: fontSize.base, color: color.onPrimary },
});
