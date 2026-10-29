// app/x~7Qz_k9-Ra/login.tsx
// Separate entry point from app/login.tsx on purpose: a regular business account
// should never land here by accident, and this screen never offers a "create
// account" path. It reuses the same POST /auth/login endpoint (there is only
// one login endpoint in the backend, and it accepts a mobile number or an
// email) but then checks is_admin via checkAdminAccess() before letting the
// token through — a non-admin who knows their own password is bounced
// straight back out, token cleared.
import { useState } from 'react';
import { View, Text, TextInput, Pressable, Image, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { color, font, fontSize, lineHeight, letterSpacing, space, radius, layout } from '../../components/ui/tokens';
import { login, logout } from '../../lib/api/auth';
import { checkAdminAccess } from '../../lib/api/admin';
import { ADMIN } from '../../lib/adminRoutes';

export default function AdminLoginRoute() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = identifier.trim().length > 0 && password.length > 0 && !loading;

  async function handleSubmit() {
    if (!canSubmit) return;
    setError(null);
    setLoading(true);
    try {
      await login({ mobileNumber: identifier.trim(), password });
      const isAdmin = await checkAdminAccess();
      if (!isAdmin) {
        logout();
        setError('This account does not have admin access.');
        return;
      }
      router.replace(ADMIN.dashboard);
    } catch (e: any) {
      setError(typeof e?.message === 'string' ? e.message : 'Invalid mobile number, email or password.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <View style={styles.cardTopBar} />
        <View style={styles.cardBody}>
          <View style={styles.brandRow}>
            <View style={styles.logoWrap}>
              <Image source={require('../../assets/logo.jpg')} style={styles.logo} resizeMode="contain" />
            </View>
            <View>
              <Text style={styles.brandEyebrow}>TrustLink</Text>
              <Text style={styles.brandTitle}>Admin console</Text>
            </View>
          </View>

          <View style={styles.restrictedPill}>
            <View style={styles.lockGlyph}>
              <View style={styles.lockShackle} />
              <View style={styles.lockBody} />
            </View>
            <Text style={styles.restrictedLabel}>Restricted area</Text>
          </View>

          <Text style={styles.title}>Sign in</Text>
          <Text style={styles.subtitle}>Only accounts with admin access can continue.</Text>

          <View style={styles.field}>
            <Text style={styles.label}>Mobile number or email</Text>
            <TextInput
              style={styles.input}
              value={identifier}
              onChangeText={setIdentifier}
              placeholder="09XX XXX XXXX or name@example.com"
              placeholderTextColor={color.inkFaint}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.passwordWrap}>
              <TextInput
                style={styles.passwordInput}
                value={password}
                onChangeText={setPassword}
                placeholder="Password"
                placeholderTextColor={color.inkFaint}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                returnKeyType="go"
                onSubmitEditing={handleSubmit}
              />
              <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={8} style={styles.showToggle}>
                <Text style={styles.showToggleLabel}>{showPassword ? 'Hide' : 'Show'}</Text>
              </Pressable>
            </View>
          </View>

          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed, !canSubmit && styles.buttonDisabled]}
            disabled={!canSubmit}
            onPress={handleSubmit}
          >
            {loading ? <ActivityIndicator color={color.onPrimary} /> : <Text style={styles.buttonLabel}>Sign in</Text>}
          </Pressable>

          <Pressable onPress={() => router.replace('/login')} hitSlop={6} style={styles.backLink}>
            <Text style={styles.backLinkLabel}>Not an admin? Go to business sign in</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
    padding: layout.screenPadding,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: color.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.border,
    overflow: 'hidden',
  },
  cardTopBar: { height: 6, backgroundColor: color.primary },
  cardBody: { padding: space.xxxl },

  brandRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.xxl },
  logoWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.borderFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: { width: 32, height: 32 },
  brandEyebrow: {
    fontFamily: font.monoMedium,
    fontSize: fontSize.micro,
    letterSpacing: letterSpacing.label,
    textTransform: 'uppercase',
    color: color.primary,
  },
  brandTitle: { fontFamily: font.display, fontSize: fontSize.md, color: color.ink },

  restrictedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.sm,
    backgroundColor: color.primaryFaint,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    marginBottom: space.md,
  },
  lockGlyph: { alignItems: 'center' },
  lockShackle: {
    width: 7,
    height: 5,
    borderWidth: 1.5,
    borderBottomWidth: 0,
    borderColor: color.primary,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  lockBody: { width: 10, height: 7, borderRadius: 1.5, backgroundColor: color.primary },
  restrictedLabel: {
    fontFamily: font.monoMedium,
    fontSize: fontSize.micro,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: color.primary,
  },

  title: {
    fontFamily: font.display,
    fontSize: fontSize.display,
    lineHeight: lineHeight.display,
    letterSpacing: letterSpacing.tight,
    color: color.ink,
  },
  subtitle: { fontFamily: font.body, fontSize: fontSize.base, color: color.inkMuted, marginTop: space.xs, marginBottom: space.xxl },

  field: { marginBottom: space.lg },
  label: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.ink, marginBottom: space.xs },
  input: {
    minHeight: layout.minTouchTarget,
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
  passwordWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: layout.minTouchTarget,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    backgroundColor: color.canvas,
    paddingRight: space.md,
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    fontFamily: font.body,
    fontSize: fontSize.base,
    color: color.ink,
  },
  showToggle: { paddingVertical: space.xs },
  showToggleLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.primary },

  errorBox: {
    backgroundColor: color.dangerFaint,
    borderWidth: 1,
    borderColor: color.dangerBorder,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    marginBottom: space.md,
  },
  errorText: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.danger },

  button: {
    minHeight: layout.minTouchTarget,
    backgroundColor: color.primary,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.sm,
  },
  buttonPressed: { backgroundColor: color.primaryPressed },
  buttonDisabled: { opacity: 0.5 },
  buttonLabel: { fontFamily: font.bodySemi, fontSize: fontSize.base, color: color.onPrimary },

  backLink: { alignSelf: 'center', marginTop: space.xl },
  backLinkLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.inkMuted },
});
