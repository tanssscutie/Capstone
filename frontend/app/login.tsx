// app/login.tsx
// New screen — the design files didn't include a login/register step (onboarding.tsx
// only ever collected business profile info, not credentials). This is the minimal
// entry point needed to actually call POST /auth/register and POST /auth/login.
import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, Image, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { color, font, fontSize, space, radius } from '../components/ui/tokens';
import {
  register,
  login,
  verifyEmail,
  resendOtp,
  requestPasswordReset,
  resetPassword,
  googleLoginUrl,
  EmailNotVerifiedError,
} from '../lib/api/auth';
import { errorMessage } from '../lib/api/client';

// VERIFY is the OTP step: reached right after REGISTER, or from LOGIN when the
// account's email was never confirmed. Kept as a mode of this screen, not its
// own route, so the pending email lives in state instead of the URL.
// FORGOT (enter the email to send a code to) and RESET (enter that code plus
// a new password) are the equivalent pair for a signed-out password reset.
type Mode = 'LOGIN' | 'REGISTER' | 'VERIFY' | 'FORGOT' | 'RESET';

// Matches the backend's OTP_RESEND_COOLDOWN_SECONDS — the server is the real
// enforcer (it answers 429), this just keeps the button honest.
const RESEND_COOLDOWN_SECONDS = 60;

export default function LoginRoute() {
  const router = useRouter();
  const { googleError } = useLocalSearchParams<{ googleError?: string }>();
  const [mode, setMode] = useState<Mode>('LOGIN');
  const [businessName, setBusinessName] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(typeof googleError === 'string' ? googleError : null);

  const [code, setCode] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  // FORGOT / RESET password flow — separate state from the sign-up VERIFY
  // step above so switching between them (e.g. "Back to log in" mid-reset)
  // never leaves stale values behind for the other flow.
  const [resetEmail, setResetEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [resetResendIn, setResetResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  useEffect(() => {
    if (resetResendIn <= 0) return;
    const t = setTimeout(() => setResetResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resetResendIn]);

  function goToVerify(address: string, cooldown: number) {
    setPendingEmail(address);
    setCode('');
    setResendIn(cooldown);
    setNotice(null);
    setMode('VERIFY');
  }

  async function handleSubmit() {
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      if (mode === 'REGISTER') {
        await register({ businessName, mobileNumber, email, password });
        // A code was just emailed; they log in by confirming it, not by
        // typing the password again.
        goToVerify(email.trim().toLowerCase(), RESEND_COOLDOWN_SECONDS);
        return;
      }
      await login({ mobileNumber, password });
      router.replace('/home');
    } catch (e: any) {
      if (e instanceof EmailNotVerifiedError) {
        goToVerify(e.email, 0);
        return;
      }
      setError(typeof e?.message === 'string' ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify() {
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      await verifyEmail(pendingEmail, code);
      // Straight to home, not onboarding — verification is something they start
      // from there (the "Complete Verification" prompt), not something forced on
      // them the instant they have an account. They can browse the feed unverified;
      // posting/quoting is what's gated on actually completing it.
      router.replace('/home');
    } catch (e) {
      setError(errorMessage(e, 'Could not verify the code. Please try again.'));
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setError(null);
    setNotice(null);
    try {
      await resendOtp(pendingEmail);
      setResendIn(RESEND_COOLDOWN_SECONDS);
      setNotice('A new code is on its way.');
    } catch (e) {
      setError(errorMessage(e, 'Could not resend the code. Please try again.'));
    }
  }

  async function handleForgotSubmit() {
    setError(null);
    setLoading(true);
    try {
      // Always moves on to RESET, matching the backend's "same response
      // either way" anti-enumeration design — it never tells us whether the
      // email actually had an account.
      await requestPasswordReset(resetEmail.trim().toLowerCase());
      setResetCode('');
      setNewPassword('');
      setConfirmNewPassword('');
      setResetResendIn(RESEND_COOLDOWN_SECONDS);
      setNotice(null);
      setMode('RESET');
    } catch (e) {
      setError(errorMessage(e, 'Could not send the code. Please try again.'));
    } finally {
      setLoading(false);
    }
  }

  async function handleResetResend() {
    setError(null);
    setNotice(null);
    try {
      await requestPasswordReset(resetEmail.trim().toLowerCase());
      setResetResendIn(RESEND_COOLDOWN_SECONDS);
      setNotice('A new code is on its way.');
    } catch (e) {
      setError(errorMessage(e, 'Could not resend the code. Please try again.'));
    }
  }

  async function handleResetSubmit() {
    setError(null);
    setLoading(true);
    try {
      await resetPassword(resetEmail.trim().toLowerCase(), resetCode, newPassword);
      setMobileNumber('');
      setPassword('');
      setNotice('Password updated. Log in with your new password.');
      setMode('LOGIN');
    } catch (e) {
      setError(errorMessage(e, 'Could not reset your password. Please try again.'));
    } finally {
      setLoading(false);
    }
  }

  const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const emailValid = EMAIL_PATTERN.test(email.trim());
  const passwordsMatch = password === confirmPassword;
  const canSubmit =
    mobileNumber.trim().length > 0 &&
    password.length >= 8 &&
    (mode === 'LOGIN' || (businessName.trim().length > 1 && emailValid && passwordsMatch));

  const resetEmailValid = EMAIL_PATTERN.test(resetEmail.trim());
  const newPasswordsMatch = newPassword === confirmNewPassword;
  const canSubmitReset = resetCode.length === 6 && newPassword.length >= 8 && newPasswordsMatch;

  if (mode === 'VERIFY') {
    return (
      <View style={styles.screen}>
        <View style={styles.card}>
          <View style={styles.brandRow}>
            <Image source={require('../assets/logo.jpg')} style={styles.brandLogo} resizeMode="contain" />
            <Text style={styles.title}>TrustLink</Text>
          </View>
          <Text style={styles.subtitle}>Verify your email</Text>
          <Text style={styles.helper}>
            We sent a 6-digit code to <Text style={styles.helperStrong}>{pendingEmail}</Text>. Enter it below to finish
            creating your account.
          </Text>

          <View style={styles.field}>
            <Text style={styles.label}>Verification code</Text>
            <TextInput
              style={[styles.input, styles.codeInput]}
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              placeholderTextColor={color.inkFaint}
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
            />
          </View>

          {error && <Text style={styles.error}>{error}</Text>}
          {notice && <Text style={styles.notice}>{notice}</Text>}

          <Pressable
            style={[styles.button, (code.length !== 6 || loading) && styles.buttonDisabled]}
            disabled={code.length !== 6 || loading}
            onPress={handleVerify}
          >
            {loading ? (
              <ActivityIndicator color={color.onPrimary} />
            ) : (
              <Text style={styles.buttonLabel}>Verify and continue</Text>
            )}
          </Pressable>

          <Pressable onPress={handleResend} disabled={resendIn > 0} style={{ marginTop: space.lg }}>
            <Text style={styles.switchText}>
              Didn't get it?{' '}
              <Text style={resendIn > 0 ? styles.switchDisabled : styles.switchLink}>
                {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
              </Text>
            </Text>
          </Pressable>

          <Pressable
            onPress={() => {
              setError(null);
              setMode('LOGIN');
            }}
            style={{ marginTop: space.md }}
          >
            <Text style={styles.switchText}>
              <Text style={styles.switchLink}>Back to log in</Text>
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (mode === 'FORGOT') {
    return (
      <View style={styles.screen}>
        <View style={styles.card}>
          <View style={styles.brandRow}>
            <Image source={require('../assets/logo.jpg')} style={styles.brandLogo} resizeMode="contain" />
            <Text style={styles.title}>TrustLink</Text>
          </View>
          <Text style={styles.subtitle}>Reset your password</Text>
          <Text style={styles.helper}>
            Enter the email on your account and we'll send a 6-digit code to reset your password.
          </Text>

          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={resetEmail}
              onChangeText={setResetEmail}
              placeholder="you@business.com"
              placeholderTextColor={color.inkFaint}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
            />
          </View>

          {error && <Text style={styles.error}>{error}</Text>}

          <Pressable
            style={[styles.button, (!resetEmailValid || loading) && styles.buttonDisabled]}
            disabled={!resetEmailValid || loading}
            onPress={handleForgotSubmit}
          >
            {loading ? <ActivityIndicator color={color.onPrimary} /> : <Text style={styles.buttonLabel}>Send code</Text>}
          </Pressable>

          <Pressable
            onPress={() => {
              setError(null);
              setMode('LOGIN');
            }}
            style={{ marginTop: space.lg }}
          >
            <Text style={styles.switchText}>
              <Text style={styles.switchLink}>Back to log in</Text>
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (mode === 'RESET') {
    return (
      <View style={styles.screen}>
        <View style={styles.card}>
          <View style={styles.brandRow}>
            <Image source={require('../assets/logo.jpg')} style={styles.brandLogo} resizeMode="contain" />
            <Text style={styles.title}>TrustLink</Text>
          </View>
          <Text style={styles.subtitle}>Enter your code</Text>
          <Text style={styles.helper}>
            If <Text style={styles.helperStrong}>{resetEmail}</Text> has an account, we sent it a 6-digit code. Enter it
            below with your new password.
          </Text>

          <View style={styles.field}>
            <Text style={styles.label}>Reset code</Text>
            <TextInput
              style={[styles.input, styles.codeInput]}
              value={resetCode}
              onChangeText={(v) => setResetCode(v.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              placeholderTextColor={color.inkFaint}
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>New password</Text>
            <TextInput
              style={styles.input}
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="At least 8 characters"
              placeholderTextColor={color.inkFaint}
              secureTextEntry
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Confirm new password</Text>
            <TextInput
              style={[styles.input, confirmNewPassword.length > 0 && !newPasswordsMatch ? styles.inputError : null]}
              value={confirmNewPassword}
              onChangeText={setConfirmNewPassword}
              placeholder="Retype your new password"
              placeholderTextColor={color.inkFaint}
              secureTextEntry
            />
            {confirmNewPassword.length > 0 && !newPasswordsMatch && (
              <Text style={styles.fieldError}>Passwords don't match.</Text>
            )}
          </View>

          {error && <Text style={styles.error}>{error}</Text>}
          {notice && <Text style={styles.notice}>{notice}</Text>}

          <Pressable
            style={[styles.button, (!canSubmitReset || loading) && styles.buttonDisabled]}
            disabled={!canSubmitReset || loading}
            onPress={handleResetSubmit}
          >
            {loading ? <ActivityIndicator color={color.onPrimary} /> : <Text style={styles.buttonLabel}>Reset password</Text>}
          </Pressable>

          <Pressable onPress={handleResetResend} disabled={resetResendIn > 0} style={{ marginTop: space.lg }}>
            <Text style={styles.switchText}>
              Didn't get it?{' '}
              <Text style={resetResendIn > 0 ? styles.switchDisabled : styles.switchLink}>
                {resetResendIn > 0 ? `Resend code in ${resetResendIn}s` : 'Resend code'}
              </Text>
            </Text>
          </Pressable>

          <Pressable
            onPress={() => {
              setError(null);
              setMode('LOGIN');
            }}
            style={{ marginTop: space.md }}
          >
            <Text style={styles.switchText}>
              <Text style={styles.switchLink}>Back to log in</Text>
            </Text>
          </Pressable>
        </View>
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
          <Text style={styles.label}>{mode === 'LOGIN' ? 'Mobile number or email' : 'Mobile number'}</Text>
          {mode === 'LOGIN' ? (
            <TextInput
              style={styles.input}
              value={mobileNumber}
              onChangeText={setMobileNumber}
              placeholder="09175550118 or you@business.com"
              placeholderTextColor={color.inkFaint}
              autoCapitalize="none"
              autoCorrect={false}
            />
          ) : (
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
          )}
        </View>

        {mode === 'REGISTER' && (
          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={[styles.input, email.length > 0 && !emailValid ? styles.inputError : null]}
              value={email}
              onChangeText={setEmail}
              placeholder="you@business.com"
              placeholderTextColor={color.inkFaint}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {email.length > 0 && !emailValid && <Text style={styles.fieldError}>Enter a valid email address.</Text>}
          </View>
        )}

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

        {mode === 'LOGIN' && (
          <Pressable
            onPress={() => {
              setError(null);
              setNotice(null);
              // A head start if they typed their email into the login field
              // already — still fully editable on the next screen either way.
              setResetEmail(mobileNumber.includes('@') ? mobileNumber.trim() : '');
              setMode('FORGOT');
            }}
            style={{ alignSelf: 'flex-end', marginTop: space.xs, marginBottom: space.sm }}
          >
            <Text style={styles.switchLink}>Forgot password?</Text>
          </Pressable>
        )}

        {mode === 'REGISTER' && (
          <View style={styles.field}>
            <Text style={styles.label}>Confirm password</Text>
            <TextInput
              style={[styles.input, confirmPassword.length > 0 && !passwordsMatch ? styles.inputError : null]}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Retype your password"
              placeholderTextColor={color.inkFaint}
              secureTextEntry
            />
            {confirmPassword.length > 0 && !passwordsMatch && <Text style={styles.fieldError}>Passwords don't match.</Text>}
          </View>
        )}

        {error && <Text style={styles.error}>{error}</Text>}
        {notice && <Text style={styles.notice}>{notice}</Text>}

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

        <Pressable
          onPress={() => {
            setError(null);
            setNotice(null);
            setMode(mode === 'LOGIN' ? 'REGISTER' : 'LOGIN');
          }}
          style={{ marginTop: space.lg }}
        >
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
  inputError: {
    borderColor: color.danger,
  },
  fieldError: {
    fontFamily: font.body,
    fontSize: fontSize.sm,
    color: color.danger,
    marginTop: space.xs,
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
  switchDisabled: {
    fontFamily: font.bodyMedium,
    color: color.inkFaint,
  },
  helper: {
    fontFamily: font.body,
    fontSize: fontSize.sm,
    color: color.inkMuted,
    marginBottom: space.xl,
  },
  helperStrong: {
    fontFamily: font.bodyMedium,
    color: color.ink,
  },
  codeInput: {
    textAlign: 'center',
    letterSpacing: 8,
    fontSize: fontSize.xl,
  },
  notice: {
    fontFamily: font.body,
    fontSize: fontSize.sm,
    color: color.inkMuted,
    marginBottom: space.md,
  },
});
