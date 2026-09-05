    // app/admin-login.tsx
// Separate entry point from app/login.tsx on purpose: a regular business account
// should never land here by accident, and this screen never offers a "create
// account" path. It reuses the same POST /auth/login endpoint (there is only
// one login endpoint in the backend) but then checks is_admin via
// checkAdminAccess() before letting the token through — a non-admin who knows
// their own password is bounced straight back out, token cleared.
import { useState } from 'react';
import { View, Text, TextInput, Pressable, Image, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { color, font, fontSize, space, radius } from '../components/ui/tokens';
import { login, logout } from '../lib/api/auth';
import { checkAdminAccess } from '../lib/api/admin';

export default function AdminLoginRoute() {
  const router = useRouter();
  const [mobileNumber, setMobileNumber] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    setLoading(true);
    try {
      await login({ mobileNumber, password });
      const isAdmin = await checkAdminAccess();
      if (!isAdmin) {
        logout();
        setError('This account does not have admin access.');
        return;
      }
      router.replace('/admin');
    } catch (e: any) {
      setError(typeof e?.message === 'string' ? e.message : 'Invalid mobile number or password.');
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = mobileNumber.trim().length > 0 && password.length > 0;

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <View style={styles.brandRow}>
          <Image source={require('../assets/logo.jpg')} style={styles.brandLogo} resizeMode="contain" />
          <Text style={styles.eyebrow}>TrustLink Admin</Text>
        </View>
        <Text style={styles.title}>Admin sign in</Text>
        <Text style={styles.subtitle}>Restricted to accounts with admin access.</Text>

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

        <View style={styles.field}>
          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor={color.inkFaint}
            secureTextEntry
          />
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable
          style={[styles.button, (!canSubmit || loading) && styles.buttonDisabled]}
          disabled={!canSubmit || loading}
          onPress={handleSubmit}
        >
          {loading ? <ActivityIndicator color={color.onPrimary} /> : <Text style={styles.buttonLabel}>Sign in</Text>}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.canvas,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
    padding: space.xxl,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginBottom: space.sm,
  },
  brandLogo: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
  },
  eyebrow: {
    fontFamily: font.monoMedium,
    fontSize: fontSize.micro,
    color: color.inkMuted,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: font.display,
    fontSize: fontSize.xl,
    color: color.ink,
    marginBottom: space.xs,
  },
  subtitle: {
    fontFamily: font.body,
    fontSize: fontSize.base,
    color: color.inkMuted,
    marginBottom: space.xxl,
  },
  field: {
    marginBottom: space.lg,
  },
  label: {
    fontFamily: font.bodyMedium,
    fontSize: fontSize.sm,
    color: color.ink,
    marginBottom: space.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    fontFamily: font.body,
    fontSize: fontSize.base,
    color: color.ink,
    backgroundColor: color.canvas,
  },
  error: {
    fontFamily: font.body,
    fontSize: fontSize.sm,
    color: color.danger,
    marginBottom: space.md,
  },
  button: {
    backgroundColor: color.primary,
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: 'center',
    marginTop: space.sm,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonLabel: {
    fontFamily: font.bodySemi,
    fontSize: fontSize.base,
    color: color.onPrimary,
  },
});