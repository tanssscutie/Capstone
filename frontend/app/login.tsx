// app/login.tsx
// New screen — the design files didn't include a login/register step (onboarding.tsx
// only ever collected business profile info, not credentials). This is the entry
// point that calls POST /auth/register and POST /auth/login. Every mode shares the
// same AuthShell chrome as admin-login.tsx: a top-barred card on phones, and a
// navy brand panel beside the form at and above breakpoint.desktop.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Image,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  AccessibilityInfo,
  useWindowDimensions,
} from 'react-native';
import type { TextInputProps, ViewStyle, StyleProp } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { color, font, fontSize, lineHeight, letterSpacing, space, radius, layout, breakpoint } from '../components/ui/tokens';
import {
  register,
  login,
  verifyEmail,
  resendOtp,
  requestPasswordReset,
  resetPassword,
  googleLoginUrl,
  EmailNotVerifiedError,
  YEARS_IN_BUSINESS_OPTIONS,
} from '../lib/api/auth';
import type { YearsInBusiness } from '../lib/api/auth';
import { useCategoryTree } from '../lib/data/categories';
import { errorMessage } from '../lib/api/client';
import { PrivacyConsent } from '../components/ui/PrivacyConsent';
import { RolePicker } from '../components/ui/RolePicker';
import type { AccountRole } from '../lib/types';

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
  // googleError: a refused Google sign-in. blocked: signed out because the
  // account was suspended or banned (lib/api/client.ts).
  const { googleError, blocked } = useLocalSearchParams<{ googleError?: string; blocked?: string }>();
  const [mode, setMode] = useState<Mode>('LOGIN');
  const [businessName, setBusinessName] = useState('');
  const [role, setRole] = useState<AccountRole | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const { categories } = useCategoryTree();
  const [yearsInBusiness, setYearsInBusiness] = useState<YearsInBusiness | null>(null);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [mobileNumber, setMobileNumber] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    typeof blocked === 'string' ? blocked : typeof googleError === 'string' ? googleError : null,
  );

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

  function switchMode(next: Mode) {
    setError(null);
    setNotice(null);
    setMode(next);
  }

  async function handleSubmit() {
    if (!canSubmit || loading) return;
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      if (mode === 'REGISTER') {
        if (!role || !category) return; // canSubmit already requires both
        await register({
          businessName,
          mobileNumber,
          email,
          password,
          role,
          category,
          yearsInBusiness: role === 'seller' && yearsInBusiness ? yearsInBusiness : undefined,
          acceptPrivacy: agreePrivacy,
        });
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
  const passwordLongEnough = password.length >= 8;
  const passwordsMatch = password === confirmPassword;
  const canSubmit =
    mobileNumber.trim().length > 0 &&
    passwordLongEnough &&
    (mode === 'LOGIN' ||
      (role !== null &&
        category !== null &&
        (role === 'buyer' || yearsInBusiness !== null) &&
        businessName.trim().length > 1 &&
        emailValid &&
        passwordsMatch &&
        agreePrivacy));

  const resetEmailValid = EMAIL_PATTERN.test(resetEmail.trim());
  const newPasswordsMatch = newPassword === confirmNewPassword;
  const canSubmitReset = resetCode.length === 6 && newPassword.length >= 8 && newPasswordsMatch;

  // Keyed by the message so a second, different error re-plays the entrance
  // instead of silently swapping text in a box that's already there.
  const feedback = (
    <>
      {error && (
        <FadeIn key={`e:${error}`} distance={6} duration={240}>
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        </FadeIn>
      )}
      {notice && (
        <FadeIn key={`n:${notice}`} distance={6} duration={240}>
          <View style={styles.noticeBox}>
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        </FadeIn>
      )}
    </>
  );

  if (mode === 'VERIFY') {
    return (
      <AuthShell contentKey={mode}>
        <FormHeader
          eyebrow="Almost there"
          title="Verify your email"
          subtitle={
            <>
              We sent a 6-digit code to <Text style={styles.strong}>{pendingEmail}</Text>. Enter it below to finish
              creating your account.
            </>
          }
        />

        <Field label="Verification code">
          <Input
            style={styles.codeInput}
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
          />
        </Field>

        {feedback}

        <PrimaryButton
          label="Verify and continue"
          loading={loading}
          disabled={code.length !== 6}
          onPress={handleVerify}
        />

        <ResendLink seconds={resendIn} onPress={handleResend} />
        <BackToLogin onPress={() => switchMode('LOGIN')} />
      </AuthShell>
    );
  }

  if (mode === 'FORGOT') {
    return (
      <AuthShell contentKey={mode}>
        <FormHeader
          eyebrow="Account recovery"
          title="Reset your password"
          subtitle="Enter the email on your account and we'll send a 6-digit code to reset your password."
        />

        <Field label="Email">
          <Input
            value={resetEmail}
            onChangeText={setResetEmail}
            placeholder="you@business.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
          />
        </Field>

        {feedback}

        <PrimaryButton label="Send code" loading={loading} disabled={!resetEmailValid} onPress={handleForgotSubmit} />
        <BackToLogin onPress={() => switchMode('LOGIN')} />
      </AuthShell>
    );
  }

  if (mode === 'RESET') {
    return (
      <AuthShell contentKey={mode}>
        <FormHeader
          eyebrow="Account recovery"
          title="Enter your code"
          subtitle={
            <>
              If <Text style={styles.strong}>{resetEmail}</Text> has an account, we sent it a 6-digit code. Enter it
              below with your new password.
            </>
          }
        />

        <Field label="Reset code">
          <Input
            style={styles.codeInput}
            value={resetCode}
            onChangeText={(v) => setResetCode(v.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
          />
        </Field>

        <Field label="New password">
          <PasswordInput value={newPassword} onChangeText={setNewPassword} placeholder="At least 8 characters" />
        </Field>

        <Field
          label="Confirm new password"
          error={confirmNewPassword.length > 0 && !newPasswordsMatch ? "Passwords don't match." : null}
        >
          <PasswordInput
            value={confirmNewPassword}
            onChangeText={setConfirmNewPassword}
            placeholder="Retype your new password"
            invalid={confirmNewPassword.length > 0 && !newPasswordsMatch}
          />
        </Field>

        {feedback}

        <PrimaryButton label="Reset password" loading={loading} disabled={!canSubmitReset} onPress={handleResetSubmit} />
        <ResendLink seconds={resetResendIn} onPress={handleResetResend} />
        <BackToLogin onPress={() => switchMode('LOGIN')} />
      </AuthShell>
    );
  }

  const isRegister = mode === 'REGISTER';

  return (
    <AuthShell contentKey="AUTH">
      <FormHeader
        eyebrow={isRegister ? 'New account' : 'Welcome back'}
        title={isRegister ? 'Create your account' : 'Log in to TrustLink'}
        subtitle={
          isRegister
            ? "Takes a minute. We'll email a code to confirm it's you."
            : 'Pick up where you left off with your requirements and quotations.'
        }
      />

      <ModeTabs mode={isRegister ? 'REGISTER' : 'LOGIN'} onChange={switchMode} />

      {/* Keyed by mode so the fields slide in fresh on every tab switch, while
          the tabs above stay mounted and their indicator glides across. */}
      <FadeIn key={mode} distance={10}>
      {isRegister ? (
        <>
          <RolePicker value={role} onChange={setRole} compact />

          {role === null ? (
            <View style={styles.pickRoleHint}>
              <Text style={styles.pickRoleHintText}>Choose an account type above to continue.</Text>
            </View>
          ) : (
            // Keyed by role so switching buyer/seller replays the entrance and the
            // seller-only "Years in business" doesn't just pop in or out.
            <FadeIn key={role} distance={8} duration={300}>
              <Field label="Business name">
                <Input
                  value={businessName}
                  onChangeText={setBusinessName}
                  placeholder="Santiago Print Shop"
                  autoCapitalize="words"
                />
              </Field>

              <FieldRow>
                <Field label="Business email" flex error={email.length > 0 && !emailValid ? 'Enter a valid email address.' : null}>
                  <Input
                    invalid={email.length > 0 && !emailValid}
                    value={email}
                    onChangeText={setEmail}
                    placeholder="you@business.com"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </Field>
                <Field label="Mobile number" flex>
                  <Input
                    value={mobileNumber}
                    onChangeText={(v) => setMobileNumber(v.replace(/\D/g, '').slice(0, 11))}
                    placeholder="09175550118"
                    keyboardType="number-pad"
                    autoCapitalize="none"
                    maxLength={11}
                  />
                </Field>
              </FieldRow>

              <FieldRow>
                <Field label={role === 'buyer' ? 'Primary procurement category' : 'Business category'} flex>
                  <Select
                    placeholder="Select a category"
                    options={categories.map((c) => ({ value: c, label: c }))}
                    value={category}
                    onChange={setCategory}
                  />
                </Field>
                {role === 'seller' && (
                  <Field label="Years in business" flex>
                    <Select
                      placeholder="Select"
                      options={YEARS_IN_BUSINESS_OPTIONS}
                      value={yearsInBusiness}
                      onChange={setYearsInBusiness}
                    />
                  </Field>
                )}
              </FieldRow>

              <FieldRow>
                <Field label="Password" flex>
                  <PasswordInput value={password} onChangeText={setPassword} placeholder="8+ characters" />
                </Field>
                <Field label="Confirm password" flex>
                  <PasswordInput
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    placeholder="Retype password"
                    invalid={confirmPassword.length > 0 && !passwordsMatch}
                    onSubmitEditing={handleSubmit}
                  />
                </Field>
              </FieldRow>

              <View style={styles.checklist}>
                <CheckItem met={passwordLongEnough} label="At least 8 characters" />
                <CheckItem met={confirmPassword.length > 0 && passwordsMatch} label="Passwords match" />
              </View>

              <PrivacyConsent checked={agreePrivacy} onChange={setAgreePrivacy} />
            </FadeIn>
          )}
        </>
      ) : (
        <>
          <Field label="Mobile number or email">
            <Input
              value={mobileNumber}
              onChangeText={setMobileNumber}
              placeholder="09175550118 or you@business.com"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
            />
          </Field>

          <View style={styles.passwordLabelRow}>
            <Text style={styles.label}>Password</Text>
            <Pressable
              onPress={() => {
                // A head start if they typed their email into the login field
                // already — still fully editable on the next screen either way.
                setResetEmail(mobileNumber.includes('@') ? mobileNumber.trim() : '');
                switchMode('FORGOT');
              }}
              hitSlop={6}
            >
              <Text style={styles.link}>Forgot password?</Text>
            </Pressable>
          </View>
          <View style={styles.field}>
            <PasswordInput
              value={password}
              onChangeText={setPassword}
              placeholder="Your password"
              onSubmitEditing={handleSubmit}
            />
          </View>
        </>
      )}
      </FadeIn>

      {feedback}

      <PrimaryButton
        label={isRegister ? 'Create account' : 'Log in'}
        loading={loading}
        disabled={!canSubmit}
        onPress={handleSubmit}
      />

      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>or</Text>
        <View style={styles.dividerLine} />
      </View>

      <GoogleButton
        onPress={() => {
          if (typeof window !== 'undefined') window.location.href = googleLoginUrl();
        }}
      />

      <Pressable onPress={() => switchMode(isRegister ? 'LOGIN' : 'REGISTER')} style={styles.footerLink} hitSlop={6}>
        <Text style={styles.mutedCenter}>
          {isRegister ? 'Already have an account? ' : "Don't have an account? "}
          <Text style={styles.link}>{isRegister ? 'Log in' : 'Create one'}</Text>
        </Text>
      </Pressable>
    </AuthShell>
  );
}

const TRUST_POINTS: { title: string; body: string }[] = [
  { title: 'Sealed quotations', body: 'Bids stay hidden until the closing time, so every seller competes fairly.' },
  { title: 'Verified businesses', body: 'Permits and registrations are checked before an account is marked verified.' },
  { title: 'A record you can audit', body: 'Every award and status change is logged on the ledger.' },
];

// Three widths: compact phones (< COMPACT_WIDTH) get tighter padding and a
// smaller title so the form isn't squeezed; regular phones/tablets get the
// centred card; breakpoint.desktop and up adds the brand panel beside it.
const COMPACT_WIDTH = 400;

function useAuthLayout() {
  const { width } = useWindowDimensions();
  return { isWide: width >= breakpoint.desktop, isCompact: width < COMPACT_WIDTH };
}

// ---------------------------------------------------------------------------
// Motion helpers. Core Animated only (same as HomeFeed) plus CSS transitions on
// web for hover/focus. Everything is skipped when the OS asks for reduced motion.

/** RN-web passes these straight through as CSS; native ignores them. */
function webTransition(properties: string): ViewStyle {
  return Platform.OS === 'web'
    ? ({
        transitionProperty: properties,
        transitionDuration: '160ms',
        transitionTimingFunction: 'ease-out',
      } as unknown as ViewStyle)
    : {};
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduced)
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => sub?.remove?.();
  }, []);
  return reduced;
}

function useHover() {
  const [hovered, setHovered] = useState(false);
  const handlers =
    Platform.OS === 'web' ? { onHoverIn: () => setHovered(true), onHoverOut: () => setHovered(false) } : {};
  return [hovered, handlers] as const;
}

/** Fades and lifts its children in once, on mount. Re-key it to replay. */
function FadeIn({
  children,
  delay = 0,
  distance = 14,
  duration = 420,
  style,
}: {
  children: ReactNode;
  delay?: number;
  distance?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress, delay, duration]);
  if (reduced) return <View style={style}>{children}</View>;
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** Slow drifting circle for the brand panel background. Purely decorative. */
function FloatingOrb({ size, style, period }: { size: number; style: ViewStyle; period: number }) {
  const reduced = useReducedMotion();
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: period, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration: period, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [t, period, reduced]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.orb,
        { width: size, height: size },
        style,
        {
          transform: [
            { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -18] }) },
            { scale: t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) },
          ],
        },
      ]}
    />
  );
}

function AuthShell({ children, contentKey }: { children: ReactNode; contentKey: string }) {
  const { isWide, isCompact } = useAuthLayout();
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.screenContent, isCompact && styles.screenContentCompact]}
      keyboardShouldPersistTaps="handled"
    >
      <FadeIn distance={24} duration={520} style={[styles.frame, isWide && styles.frameWide]}>
        {isWide && (
          <View style={styles.brandPanel}>
            <FloatingOrb size={340} period={7000} style={{ top: -120, right: -140 }} />
            <FloatingOrb size={220} period={5200} style={{ bottom: -70, left: -90 }} />

            <FadeIn delay={120}>
              <View style={styles.panelBrandRow}>
                <View style={styles.panelLogoWrap}>
                  <Image source={require('../assets/logo.jpg')} style={styles.logo} resizeMode="contain" />
                </View>
                <Text style={styles.panelBrandName}>TrustLink</Text>
              </View>
              <Text style={styles.panelHeadline}>Procurement you can trust.</Text>
              <Text style={styles.panelLead}>
                Post requirements, receive sealed quotations, and award with confidence.
              </Text>
            </FadeIn>

            <View style={styles.panelPoints}>
              {TRUST_POINTS.map((p, i) => (
                <FadeIn key={p.title} delay={300 + i * 130}>
                  <TrustPoint title={p.title} body={p.body} />
                </FadeIn>
              ))}
            </View>

            <FadeIn delay={720}>
              <Text style={styles.panelFooter}>Sealed · Verified · Accountable</Text>
            </FadeIn>
          </View>
        )}

        <View style={[styles.card, isWide && styles.cardWide]}>
          {!isWide && <View style={styles.cardTopBar} />}
          <View style={[styles.cardBody, isWide && styles.cardBodyWide, isCompact && styles.cardBodyCompact]}>
            {!isWide && (
              <View style={styles.brandRow}>
                <View style={styles.logoWrap}>
                  <Image source={require('../assets/logo.jpg')} style={styles.logoSmall} resizeMode="contain" />
                </View>
                <Text style={styles.brandName}>TrustLink</Text>
              </View>
            )}
            {/* Re-keyed per screen (verify / forgot / reset) so each one slides in. */}
            <FadeIn key={contentKey} distance={10} duration={340}>
              {children}
            </FadeIn>
          </View>
        </View>
      </FadeIn>
    </ScrollView>
  );
}

function TrustPoint({ title, body }: { title: string; body: string }) {
  const [hovered, hoverHandlers] = useHover();
  return (
    <Pressable
      {...hoverHandlers}
      accessible={false}
      style={[styles.panelPoint, webTransition('transform, background-color'), hovered && styles.panelPointHovered]}
    >
      <View style={styles.panelCheck}>
        <View style={styles.panelCheckMark} />
      </View>
      <View style={styles.panelPointText}>
        <Text style={styles.panelPointTitle}>{title}</Text>
        <Text style={styles.panelPointBody}>{body}</Text>
      </View>
    </Pressable>
  );
}

/** Log in / Create account switch with an indicator that glides between tabs. */
function ModeTabs({ mode, onChange }: { mode: 'LOGIN' | 'REGISTER'; onChange: (m: Mode) => void }) {
  const [width, setWidth] = useState(0);
  const position = useRef(new Animated.Value(mode === 'REGISTER' ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(position, {
      toValue: mode === 'REGISTER' ? 1 : 0,
      useNativeDriver: true,
      speed: 18,
      bounciness: 5,
    }).start();
  }, [mode, position]);
  const segment = Math.max(0, (width - space.xs * 2) / 2);
  return (
    <View style={styles.tabs} accessibilityRole="tablist" onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && (
        <Animated.View
          style={[
            styles.tabIndicator,
            {
              width: segment,
              transform: [{ translateX: position.interpolate({ inputRange: [0, 1], outputRange: [0, segment] }) }],
            },
          ]}
        />
      )}
      {(['LOGIN', 'REGISTER'] as const).map((m) => {
        const active = mode === m;
        return (
          <Pressable
            key={m}
            onPress={() => !active && onChange(m)}
            style={styles.tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.tabLabel, webTransition('color'), active && styles.tabLabelActive]}>
              {m === 'LOGIN' ? 'Log in' : 'Create account'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** TextInput that lights up its border (and a soft ring on web) while focused. */
function Input({ invalid, style, onFocus, onBlur, ...props }: TextInputProps & { invalid?: boolean }) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      {...props}
      placeholderTextColor={color.inkFaint}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      style={[
        styles.input,
        webTransition('border-color, background-color, box-shadow'),
        focused && styles.inputFocused,
        invalid && styles.inputError,
        style,
      ]}
    />
  );
}

/** Compact single-choice dropdown. Closed it's one input-height row, so two
 *  can sit side by side; the list opens in-flow below (no overlay to get
 *  clipped by the card's overflow: hidden). */
function Select<T extends string>({
  options,
  value,
  onChange,
  placeholder,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [hovered, hoverHandlers] = useHover();
  const selected = options.find((o) => o.value === value);
  return (
    <View>
      <Pressable
        {...hoverHandlers}
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={[
          styles.input,
          styles.select,
          webTransition('border-color, background-color, box-shadow'),
          hovered && !open && styles.selectHovered,
          open && styles.inputFocused,
        ]}
      >
        <Text style={[styles.selectValue, !selected && styles.selectPlaceholder]} numberOfLines={1}>
          {selected ? selected.label : placeholder}
        </Text>
        <View style={[styles.selectChevron, open && styles.selectChevronOpen]} />
      </Pressable>
      {open && (
        <FadeIn distance={-4} duration={160} style={styles.selectMenu}>
          {options.map((opt) => (
            <SelectOption
              key={opt.value}
              label={opt.label}
              active={opt.value === value}
              onPress={() => {
                onChange(opt.value);
                setOpen(false);
              }}
            />
          ))}
        </FadeIn>
      )}
    </View>
  );
}

function SelectOption({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const [hovered, hoverHandlers] = useHover();
  return (
    <Pressable
      {...hoverHandlers}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      style={[styles.selectOption, webTransition('background-color'), (hovered || active) && styles.selectOptionActive]}
    >
      <Text style={[styles.selectOptionLabel, active && styles.selectOptionLabelActive]}>{label}</Text>
    </Pressable>
  );
}

function GoogleButton({ onPress }: { onPress: () => void }) {
  const [hovered, hoverHandlers] = useHover();
  return (
    <Pressable
      {...hoverHandlers}
      onPress={onPress}
      style={({ pressed }) => [
        styles.googleButton,
        webTransition('transform, background-color, border-color'),
        hovered && styles.googleButtonHovered,
        pressed && styles.googleButtonPressed,
      ]}
    >
      <View style={styles.googleGlyph}>
        <Text style={styles.googleGlyphLabel}>G</Text>
      </View>
      <Text style={styles.googleButtonLabel}>Continue with Google</Text>
    </Pressable>
  );
}

function FormHeader({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: ReactNode }) {
  const { isCompact } = useAuthLayout();
  return (
    <View style={styles.header}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={[styles.title, isCompact && styles.titleCompact]}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  );
}

/** Puts fields side by side; each wraps onto its own line below ~180px. */
function FieldRow({ children }: { children: ReactNode }) {
  return <View style={styles.fieldRow}>{children}</View>;
}

function Field({
  label,
  hint,
  error,
  flex,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  /** Inside a FieldRow: share the row instead of taking the full width. */
  flex?: boolean;
  children: ReactNode;
}) {
  return (
    <View style={[styles.field, flex && styles.fieldFlex]}>
      <Text style={styles.label}>{label}</Text>
      {children}
      {error ? <Text style={styles.fieldError}>{error}</Text> : hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

function PasswordInput({
  value,
  onChangeText,
  placeholder,
  invalid,
  onSubmitEditing,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  invalid?: boolean;
  onSubmitEditing?: () => void;
}) {
  const [visible, setVisible] = useState(false);
  // The toggle is absolutely positioned over the input's right padding rather
  // than laid out beside it: on web a TextInput has an intrinsic ~20-character
  // width that won't shrink in a narrow column, which shoved "Show" out of the box.
  return (
    <View style={styles.passwordWrap}>
      <Input
        style={styles.passwordInput}
        invalid={invalid}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
        onSubmitEditing={onSubmitEditing}
      />
      <Pressable
        onPress={() => setVisible((v) => !v)}
        hitSlop={6}
        style={styles.showToggle}
        accessibilityRole="button"
        accessibilityLabel={visible ? 'Hide password' : 'Show password'}
      >
        <Text style={styles.showToggleLabel}>{visible ? 'Hide' : 'Show'}</Text>
      </Pressable>
    </View>
  );
}

/** Requirement row whose tick pops in (small spring) the moment it's satisfied. */
function CheckItem({ met, label }: { met: boolean; label: string }) {
  const pop = useRef(new Animated.Value(met ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(pop, { toValue: met ? 1 : 0, useNativeDriver: true, speed: 22, bounciness: 12 }).start();
  }, [met, pop]);
  return (
    <View style={styles.checkItem}>
      <View style={[styles.checkDot, webTransition('background-color, border-color'), met && styles.checkDotMet]}>
        <Animated.View style={[styles.checkDotMark, { opacity: pop, transform: [{ rotate: '-45deg' }, { scale: pop }] }]} />
      </View>
      <Text style={[styles.checkLabel, webTransition('color'), met && styles.checkLabelMet]}>{label}</Text>
    </View>
  );
}

function PrimaryButton({
  label,
  loading,
  disabled,
  onPress,
}: {
  label: string;
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const inactive = disabled || loading;
  const [hovered, hoverHandlers] = useHover();
  return (
    <Pressable
      {...hoverHandlers}
      style={({ pressed }) => [
        styles.button,
        webTransition('transform, background-color, opacity, box-shadow'),
        hovered && !inactive && styles.buttonHovered,
        pressed && styles.buttonPressed,
        inactive && styles.buttonDisabled,
      ]}
      disabled={inactive}
      onPress={onPress}
    >
      {loading ? <ActivityIndicator color={color.onPrimary} /> : <Text style={styles.buttonLabel}>{label}</Text>}
    </Pressable>
  );
}

function ResendLink({ seconds, onPress }: { seconds: number; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={seconds > 0} style={styles.footerLink}>
      <Text style={styles.mutedCenter}>
        Didn't get it?{' '}
        <Text style={seconds > 0 ? styles.linkDisabled : styles.link}>
          {seconds > 0 ? `Resend code in ${seconds}s` : 'Resend code'}
        </Text>
      </Text>
    </Pressable>
  );
}

function BackToLogin({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.backLink} hitSlop={6}>
      <Text style={styles.mutedCenter}>
        <Text style={styles.link}>Back to log in</Text>
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.surfaceSunken },
  screenContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: layout.screenPadding,
    paddingVertical: space.section,
  },
  screenContentCompact: { padding: space.md, paddingVertical: space.lg },

  frame: { width: '100%', maxWidth: layout.maxWidth },
  frameWide: {
    maxWidth: 1040,
    flexDirection: 'row',
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.border,
    overflow: 'hidden',
    backgroundColor: color.surface,
  },

  // Brand panel (wide only)
  brandPanel: {
    flex: 1,
    minWidth: 0,
    backgroundColor: color.primary,
    padding: space.section,
    justifyContent: 'space-between',
    gap: space.section,
    overflow: 'hidden',
    position: 'relative',
  },
  orb: { position: 'absolute', borderRadius: radius.pill, backgroundColor: color.onPrimary, opacity: 0.07 },
  panelBrandRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.section },
  panelLogoWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: { width: 32, height: 32 },
  panelBrandName: { fontFamily: font.display, fontSize: fontSize.lg, color: color.onPrimary },
  panelHeadline: {
    fontFamily: font.display,
    fontSize: fontSize.display,
    lineHeight: lineHeight.display,
    letterSpacing: letterSpacing.tight,
    color: color.onPrimary,
  },
  panelLead: {
    fontFamily: font.body,
    fontSize: fontSize.md,
    lineHeight: lineHeight.md,
    color: color.onPrimary,
    opacity: 0.8,
    marginTop: space.md,
  },
  panelPoints: { gap: space.xl },
  panelPoint: { flexDirection: 'row', gap: space.md, padding: space.sm, margin: -space.sm, borderRadius: radius.md },
  panelPointHovered: { backgroundColor: color.primaryPressed, transform: [{ translateX: 4 }] },
  panelCheck: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: color.onPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  panelCheckMark: {
    width: 10,
    height: 6,
    borderLeftWidth: 2,
    borderBottomWidth: 2,
    borderColor: color.onPrimary,
    transform: [{ rotate: '-45deg' }],
    marginTop: -2,
  },
  panelPointText: { flex: 1 },
  panelPointTitle: { fontFamily: font.bodySemi, fontSize: fontSize.base, color: color.onPrimary },
  panelPointBody: {
    fontFamily: font.body,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.sm,
    color: color.onPrimary,
    opacity: 0.75,
    marginTop: 2,
  },
  panelFooter: {
    fontFamily: font.monoMedium,
    fontSize: fontSize.micro,
    letterSpacing: letterSpacing.label,
    textTransform: 'uppercase',
    color: color.onPrimary,
    opacity: 0.6,
  },

  // Form card
  card: {
    width: '100%',
    backgroundColor: color.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.border,
    overflow: 'hidden',
  },
  // The form column never drops below phone width, so the brand panel is the
  // one that gives up space between 900px and the frame's max width.
  cardWide: { flex: 1.15, minWidth: layout.maxWidth - space.section, width: undefined, borderWidth: 0, borderRadius: 0 },
  cardTopBar: { height: 6, backgroundColor: color.primary },
  cardBody: { padding: space.xxl },
  cardBodyWide: { padding: space.xxxl, flex: 1, justifyContent: 'center' },
  cardBodyCompact: { padding: space.lg },

  brandRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.xl },
  logoWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.borderFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoSmall: { width: 26, height: 26 },
  brandName: { fontFamily: font.display, fontSize: fontSize.md, color: color.ink },

  header: { marginBottom: space.xl },
  eyebrow: {
    fontFamily: font.monoMedium,
    fontSize: fontSize.micro,
    letterSpacing: letterSpacing.label,
    textTransform: 'uppercase',
    color: color.primary,
    marginBottom: space.sm,
  },
  title: {
    fontFamily: font.display,
    fontSize: fontSize.xl,
    lineHeight: lineHeight.xl,
    letterSpacing: letterSpacing.tight,
    color: color.ink,
  },
  titleCompact: { fontSize: fontSize.lg, lineHeight: lineHeight.lg },
  subtitle: {
    fontFamily: font.body,
    fontSize: fontSize.base,
    lineHeight: lineHeight.base,
    color: color.inkMuted,
    marginTop: space.xs,
  },
  strong: { fontFamily: font.bodyMedium, color: color.ink },

  tabs: {
    flexDirection: 'row',
    backgroundColor: color.surfaceSunken,
    borderRadius: radius.md,
    padding: space.xs,
    marginBottom: space.xl,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.sm,
    borderRadius: radius.sm,
  },
  tabIndicator: {
    position: 'absolute',
    top: space.xs,
    bottom: space.xs,
    left: space.xs,
    backgroundColor: color.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.borderFaint,
  },
  tabLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.inkMuted },
  tabLabelActive: { fontFamily: font.bodySemi, color: color.ink },


  field: { marginBottom: space.md },
  fieldRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.md },
  fieldFlex: { flexGrow: 1, flexBasis: 180, minWidth: 0 },
  label: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.ink, marginBottom: space.xs },
  input: {
    width: '100%',
    minWidth: 0,
    minHeight: layout.minTouchTarget,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontFamily: font.body,
    fontSize: fontSize.base,
    color: color.ink,
    backgroundColor: color.canvas,
  },
  inputFocused: {
    borderColor: color.primary,
    backgroundColor: color.surface,
    ...(Platform.OS === 'web' ? ({ boxShadow: `0 0 0 3px ${color.primaryFaint}`, outlineStyle: 'none' } as object) : null),
  },
  inputError: { borderColor: color.danger },
  codeInput: { textAlign: 'center', letterSpacing: 8, fontSize: fontSize.xl, fontFamily: font.mono },
  fieldHint: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkFaint, marginTop: space.xs },
  fieldError: { fontFamily: font.body, fontSize: fontSize.sm, color: color.danger, marginTop: space.xs },

  pickRoleHint: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.border,
    borderRadius: radius.md,
    padding: space.md,
    alignItems: 'center',
    marginBottom: space.lg,
  },
  pickRoleHintText: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted },

  select: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  selectHovered: { borderColor: color.borderStrong },
  selectValue: { flex: 1, fontFamily: font.body, fontSize: fontSize.base, color: color.ink },
  selectPlaceholder: { color: color.inkFaint },
  // Chevron from two borders of a rotated square — no icon library.
  selectChevron: {
    width: 7,
    height: 7,
    borderRightWidth: 1.5,
    borderBottomWidth: 1.5,
    borderColor: color.inkMuted,
    transform: [{ rotate: '45deg' }],
    marginTop: -3,
  },
  selectChevronOpen: { transform: [{ rotate: '-135deg' }], marginTop: 3 },
  selectMenu: {
    marginTop: space.xs,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    padding: space.xs,
  },
  selectOption: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.sm },
  selectOptionActive: { backgroundColor: color.primaryFaint },
  selectOptionLabel: { fontFamily: font.body, fontSize: fontSize.base, color: color.ink },
  selectOptionLabelActive: { fontFamily: font.bodySemi, color: color.primary },

  passwordLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  passwordWrap: { position: 'relative', justifyContent: 'center' },
  passwordInput: { paddingRight: 60 },
  showToggle: {
    position: 'absolute',
    right: space.xs,
    top: space.xs,
    bottom: space.xs,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
  },
  showToggleLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.primary },

  checklist: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.lg, rowGap: space.xs, marginBottom: space.lg },
  checkItem: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  checkDot: {
    width: 16,
    height: 16,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: color.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkDotMet: { backgroundColor: color.primary, borderColor: color.primary },
  checkDotMark: {
    width: 7,
    height: 4,
    borderLeftWidth: 1.5,
    borderBottomWidth: 1.5,
    borderColor: color.onPrimary,
    marginTop: -1,
  },
  checkLabel: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkFaint },
  checkLabelMet: { color: color.ink },

  errorBox: {
    backgroundColor: color.dangerFaint,
    borderWidth: 1,
    borderColor: color.dangerBorder,
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.lg,
  },
  errorText: { fontFamily: font.body, fontSize: fontSize.sm, color: color.danger },
  noticeBox: {
    backgroundColor: color.primaryFaint,
    borderWidth: 1,
    borderColor: color.primaryBorder,
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.lg,
  },
  noticeText: { fontFamily: font.body, fontSize: fontSize.sm, color: color.primary },

  button: {
    minHeight: layout.minTouchTarget,
    backgroundColor: color.primary,
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.xs,
  },
  buttonHovered: {
    backgroundColor: color.primaryPressed,
    transform: [{ translateY: -1 }],
    ...(Platform.OS === 'web' ? ({ boxShadow: `0 6px 16px ${color.primaryBorder}` } as object) : null),
  },
  buttonPressed: { backgroundColor: color.primaryPressed, transform: [{ scale: 0.98 }] },
  buttonDisabled: { opacity: 0.5 },
  buttonLabel: { fontFamily: font.bodySemi, fontSize: fontSize.base, color: color.onPrimary },

  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.lg },
  dividerLine: { flex: 1, height: 1, backgroundColor: color.border },
  dividerText: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkFaint },

  googleButton: {
    minHeight: layout.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    paddingVertical: space.md,
    marginTop: space.lg,
    backgroundColor: color.surface,
  },
  googleButtonHovered: { borderColor: color.borderStrong, backgroundColor: color.canvas },
  googleButtonPressed: { backgroundColor: color.surfaceSunken, transform: [{ scale: 0.98 }] },
  googleGlyph: {
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleGlyphLabel: { fontFamily: font.display, fontSize: fontSize.micro, color: color.ink },
  googleButtonLabel: { fontFamily: font.bodySemi, fontSize: fontSize.base, color: color.ink },

  footerLink: { marginTop: space.lg },
  backLink: { marginTop: space.md },
  mutedCenter: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted, textAlign: 'center' },
  link: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.primary },
  linkDisabled: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.inkFaint },
});
