// app/login.tsx
// New screen — the design files didn't include a login/register step (onboarding.tsx
// only ever collected business profile info, not credentials). This is the minimal
// entry point needed to actually call POST /auth/register and POST /auth/login.
import { useState } from 'react';
import { View, Text, TextInput, Pressable, Image, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { color, font, fontSize, space, radius } from '../components/ui/tokens';
import { registerAndLogin, login, googleLoginUrl } from '../lib/api/auth';

type Mode = 'LOGIN' | 'REGISTER';

export default function LoginRoute() {
  const router = useRouter();
  const { googleError } = useLocalSearchParams<{ googleError?: string }>();
  const [mode, setMode] = useState<Mode>('LOGIN');
  const [businessName, setBusinessName] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(typeof googleError === 'string' ? googleError : null);

  async function handleSubmit() {
    setError(null);
    setLoading(true);
    try {
      if (mode === 'REGISTER') {
        await registerAndLogin({ businessName, mobileNumber, password });
        // Straight to home, not onboarding — verification is something they start
        // from there (the "Complete Verification" prompt), not something forced on
        // them the instant they have an account. They can browse the feed unverified;
        // posting/quoting is what's gated on actually completing it.
        router.replace('/home');
        return;
      }
      await login({ mobileNumber, password });
      router.replace('/home');
    } catch (e: any) {
      setError(typeof e?.message === 'string' ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const canSubmit =
    mobileNumber.trim().length > 0 && password.length >= 8 && (mode === 'LOGIN' || businessName.trim().length > 1);

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <View style={styles.brandRow}>
          <Image source={require('../assets/logo.jpg')} style={styles.brandLogo} resizeMode="contain" />
          <Text style={styles.title}>TrustLink</Text>
        </View>
        <Text style={styles.subtitle}>{mode === 'LOGIN' ? 'Log in to your account' : 'Create your account'}</Text>

        {mode === 'REGISTER' && (
          <View style={styles.field}>
            <Text style={styles.label}>Business name</Text>
            <TextInput
              style={styles.input}
              value={businessName}
              onChangeText={setBusinessName}
              placeholder="Santiago Metal Works"
              placeholderTextColor={color.inkFaint}
              autoCapitalize="words"
            />
          </View>
        )}

        <View style={styles.field}>
          <Text style={styles.label}>Mobile number</Text>
          <TextInput
            style={styles.input}
            value={mobileNumber}
            onChangeText={(v) => setMobileNumber(v.replace(/\D/g, '').slice(0, 11))}
            placeholder="09175550118"
            placeholderTextColor={color.inkFaint}
            keyboardType="number-pad"
            autoCapitalize="none"
            maxLength={11}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="At least 8 characters"
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
          {loading ? (
            <ActivityIndicator color={color.onPrimary} />
          ) : (
            <Text style={styles.buttonLabel}>{mode === 'LOGIN' ? 'Log in' : 'Create account'}</Text>
          )}
        </Pressable>

        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        <Pressable
          style={styles.googleButton}
          onPress={() => {
            if (typeof window !== 'undefined') window.location.href = googleLoginUrl();
          }}
        >
          <Text style={styles.googleButtonLabel}>Continue with Google</Text>
        </Pressable>

        <Pressable onPress={() => setMode(mode === 'LOGIN' ? 'REGISTER' : 'LOGIN')} style={{ marginTop: space.lg }}>
          <Text style={styles.switchText}>
            {mode === 'LOGIN' ? "Don't have an account? " : 'Already have an account? '}
            <Text style={styles.switchLink}>{mode === 'LOGIN' ? 'Create one' : 'Log in'}</Text>
          </Text>
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
    marginBottom: space.xs,
  },
  brandLogo: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
  },
  title: {
    fontFamily: font.display,
    fontSize: fontSize.xl,
    color: color.ink,
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
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.lg,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: color.border,
  },
  dividerText: {
    fontFamily: font.body,
    fontSize: fontSize.sm,
    color: color.inkFaint,
  },
  googleButton: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: 'center',
    marginTop: space.lg,
    backgroundColor: color.surface,
  },
  googleButtonLabel: {
    fontFamily: font.bodySemi,
    fontSize: fontSize.base,
    color: color.ink,
  },
  switchText: {
    fontFamily: font.body,
    fontSize: fontSize.sm,
    color: color.inkMuted,
    textAlign: 'center',
  },
  switchLink: {
    fontFamily: font.bodyMedium,
    color: color.primary,
  },
});
