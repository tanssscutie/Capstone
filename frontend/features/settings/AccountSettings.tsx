// features/settings/AccountSettings.tsx
// "Account Settings" — the account dropdown's second promise ("Notifications,
// mobile number, password") made real. Same page shell as AccountProfile.tsx
// (breadcrumb, hero, bordered cards) so the two feel like one settings area.

import { useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, StyleSheet, useWindowDimensions } from 'react-native';
import {
  color,
  font,
  fontSize,
  lineHeight,
  letterSpacing,
  space,
  radius,
  elevation,
  layout,
  breakpoint,
} from '../../components/ui/tokens';

export interface AccountSettingsProps {
  mobileNumber: string;
  notifyMessages: boolean;
  notifyActivity: boolean;
  onBack?: () => void;
  onChangeMobileNumber: (newNumber: string, currentPassword: string) => Promise<void>;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  onChangeNotificationPreferences: (notifyMessages: boolean, notifyActivity: boolean) => Promise<void>;
}

function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

function ActionButton({
  label,
  onPress,
  variant = 'outline',
  disabled,
}: {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'outline';
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.actionButton,
        {
          backgroundColor: variant === 'primary' ? (pressed ? color.primaryPressed : color.primary) : color.surface,
          borderColor: variant === 'primary' ? color.primary : color.border,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Text style={[styles.actionButtonLabel, { color: variant === 'primary' ? color.onPrimary : color.ink }]}>{label}</Text>
    </Pressable>
  );
}

function ToggleSwitch({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      style={[styles.switchTrack, { backgroundColor: value ? color.primary : color.surfaceSunken, borderColor: value ? color.primary : color.border, opacity: disabled ? 0.5 : 1 }]}
    >
      <View style={[styles.switchKnob, { alignSelf: value ? 'flex-end' : 'flex-start' }]} />
    </Pressable>
  );
}

function FieldError({ children }: { children: string | null }) {
  if (!children) return null;
  return <Text style={styles.errorText}>{children}</Text>;
}

function toMessage(e: any, fallback: string): string {
  return typeof e?.detail === 'string' ? e.detail : typeof e?.message === 'string' ? e.message : fallback;
}

function MobileNumberCard({ mobileNumber, onChangeMobileNumber }: Pick<AccountSettingsProps, 'mobileNumber' | 'onChangeMobileNumber'>) {
  const [editing, setEditing] = useState(false);
  const [newNumber, setNewNumber] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const openEdit = () => {
    setNewNumber(mobileNumber);
    setCurrentPassword('');
    setError(null);
    setSaved(false);
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setError(null);
  };

  const save = async () => {
    setError(null);
    if (newNumber.trim().length < 7) {
      setError('Enter a valid mobile number.');
      return;
    }
    if (!currentPassword) {
      setError('Enter your current password to confirm this change.');
      return;
    }
    setSubmitting(true);
    try {
      await onChangeMobileNumber(newNumber.trim(), currentPassword);
      setEditing(false);
      setSaved(true);
    } catch (e: any) {
      setError(toMessage(e, 'Could not update your mobile number.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.cardHeaderRow}>
        <SectionLabel>Login mobile number</SectionLabel>
        {!editing && <Pressable onPress={openEdit} hitSlop={6}><Text style={styles.editLink}>Change</Text></Pressable>}
      </View>

      {!editing ? (
        <View style={{ marginTop: space.sm, gap: space.xs }}>
          <Text style={styles.valueText}>{mobileNumber}</Text>
          <Text style={styles.mutedSmall}>Used to log in — not shown publicly.</Text>
          {saved && <Text style={styles.savedText}>Updated.</Text>}
        </View>
      ) : (
        <View style={{ marginTop: space.sm, gap: space.md }}>
          <View>
            <Text style={styles.fieldLabel}>New mobile number</Text>
            <TextInput
              value={newNumber}
              onChangeText={setNewNumber}
              placeholder="09175550142"
              placeholderTextColor={color.inkFaint}
              keyboardType="phone-pad"
              style={styles.input}
            />
          </View>
          <View>
            <Text style={styles.fieldLabel}>Current password</Text>
            <TextInput
              value={currentPassword}
              onChangeText={setCurrentPassword}
              placeholder="Confirm it's you"
              placeholderTextColor={color.inkFaint}
              secureTextEntry
              style={styles.input}
            />
          </View>
          <FieldError>{error}</FieldError>
          <View style={styles.rowButtons}>
            <ActionButton label={submitting ? 'Saving…' : 'Save'} variant="primary" onPress={save} disabled={submitting} />
            <ActionButton label="Cancel" variant="outline" onPress={cancel} disabled={submitting} />
          </View>
        </View>
      )}
    </View>
  );
}

function PasswordCard({ onChangePassword }: Pick<AccountSettingsProps, 'onChangePassword'>) {
  const [editing, setEditing] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const openEdit = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError(null);
    setSaved(false);
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setError(null);
  };

  const save = async () => {
    setError(null);
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await onChangePassword(currentPassword, newPassword);
      setEditing(false);
      setSaved(true);
    } catch (e: any) {
      setError(toMessage(e, 'Could not update your password.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.cardHeaderRow}>
        <SectionLabel>Password</SectionLabel>
        {!editing && <Pressable onPress={openEdit} hitSlop={6}><Text style={styles.editLink}>Change</Text></Pressable>}
      </View>

      {!editing ? (
        <View style={{ marginTop: space.sm, gap: space.xs }}>
          <Text style={styles.valueText}>••••••••••</Text>
          {saved && <Text style={styles.savedText}>Updated.</Text>}
        </View>
      ) : (
        <View style={{ marginTop: space.sm, gap: space.md }}>
          <View>
            <Text style={styles.fieldLabel}>Current password</Text>
            <TextInput
              value={currentPassword}
              onChangeText={setCurrentPassword}
              placeholderTextColor={color.inkFaint}
              secureTextEntry
              style={styles.input}
            />
          </View>
          <View>
            <Text style={styles.fieldLabel}>New password</Text>
            <TextInput
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="At least 8 characters"
              placeholderTextColor={color.inkFaint}
              secureTextEntry
              style={styles.input}
            />
          </View>
          <View>
            <Text style={styles.fieldLabel}>Confirm new password</Text>
            <TextInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholderTextColor={color.inkFaint}
              secureTextEntry
              style={styles.input}
            />
          </View>
          <FieldError>{error}</FieldError>
          <View style={styles.rowButtons}>
            <ActionButton label={submitting ? 'Saving…' : 'Save'} variant="primary" onPress={save} disabled={submitting} />
            <ActionButton label="Cancel" variant="outline" onPress={cancel} disabled={submitting} />
          </View>
        </View>
      )}
    </View>
  );
}

function NotificationsCard({
  notifyMessages,
  notifyActivity,
  onChangeNotificationPreferences,
}: Pick<AccountSettingsProps, 'notifyMessages' | 'notifyActivity' | 'onChangeNotificationPreferences'>) {
  const [messages, setMessages] = useState(notifyMessages);
  const [activity, setActivity] = useState(notifyActivity);
  const [savingKey, setSavingKey] = useState<'messages' | 'activity' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const flip = async (key: 'messages' | 'activity', nextValue: boolean) => {
    setError(null);
    const prevMessages = messages;
    const prevActivity = activity;
    if (key === 'messages') setMessages(nextValue);
    else setActivity(nextValue);
    setSavingKey(key);
    try {
      await onChangeNotificationPreferences(key === 'messages' ? nextValue : messages, key === 'activity' ? nextValue : activity);
    } catch (e: any) {
      setMessages(prevMessages);
      setActivity(prevActivity);
      setError(toMessage(e, 'Could not save your notification preferences.'));
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <View style={styles.card}>
      <SectionLabel>Notifications</SectionLabel>
      <View style={{ marginTop: space.sm, gap: space.lg }}>
        <View style={styles.toggleRow}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={styles.fieldLabel}>Messages</Text>
            <Text style={styles.mutedSmall}>Direct messages from businesses you're talking to.</Text>
          </View>
          <ToggleSwitch value={messages} onChange={(v) => flip('messages', v)} disabled={savingKey !== null} />
        </View>
        <View style={styles.toggleRow}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={styles.fieldLabel}>Activity</Text>
            <Text style={styles.mutedSmall}>Award decisions, clarification Q&A, verification updates, closing reminders.</Text>
          </View>
          <ToggleSwitch value={activity} onChange={(v) => flip('activity', v)} disabled={savingKey !== null} />
        </View>
        <FieldError>{error}</FieldError>
      </View>
    </View>
  );
}

export default function AccountSettings({
  mobileNumber,
  notifyMessages,
  notifyActivity,
  onBack,
  onChangeMobileNumber,
  onChangePassword,
  onChangeNotificationPreferences,
}: AccountSettingsProps) {
  const { width } = useWindowDimensions();
  const isWide = width >= breakpoint.desktop;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scrollContent}>
      <View style={isWide ? styles.pageWide : styles.page}>
        <View style={styles.breadcrumbRow}>
          <Pressable onPress={onBack} hitSlop={6}>
            <Text style={styles.breadcrumbLink}>Home</Text>
          </Pressable>
          <Text style={styles.breadcrumbSep}>/</Text>
          <Text style={styles.breadcrumbCurrent}>Account Settings</Text>
        </View>

        <View style={styles.hero}>
          <Text style={styles.heroName}>Account Settings</Text>
          <Text style={styles.mutedSmall}>Your login number, password, and what you get notified about.</Text>
        </View>

        <MobileNumberCard mobileNumber={mobileNumber} onChangeMobileNumber={onChangeMobileNumber} />
        <PasswordCard onChangePassword={onChangePassword} />
        <NotificationsCard
          notifyMessages={notifyMessages}
          notifyActivity={notifyActivity}
          onChangeNotificationPreferences={onChangeNotificationPreferences}
        />

        <View style={styles.footerRow}>
          <ActionButton label="Back to home" variant="outline" onPress={onBack} />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  scrollContent: { alignItems: 'center', paddingVertical: space.lg, paddingBottom: space.xxl },

  page: { width: '100%', maxWidth: layout.maxWidth, paddingHorizontal: layout.screenPadding, gap: space.lg },
  pageWide: { width: '100%', maxWidth: 720, paddingHorizontal: layout.screenPadding, gap: space.lg },

  breadcrumbRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  breadcrumbLink: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkFaint },
  breadcrumbSep: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkFaint },
  breadcrumbCurrent: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted },

  hero: { gap: space.xs },
  heroName: {
    fontFamily: font.display,
    fontSize: fontSize.display,
    lineHeight: lineHeight.display,
    letterSpacing: letterSpacing.tight,
    color: color.ink,
  },

  card: { ...elevation.cardRaised, borderRadius: radius.xl, backgroundColor: color.surface, padding: space.lg },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionLabel: {
    fontFamily: font.mono,
    fontSize: fontSize.micro,
    letterSpacing: letterSpacing.label,
    textTransform: 'uppercase',
    color: color.inkFaint,
  },
  editLink: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.primary },

  valueText: { fontFamily: font.bodyMedium, fontSize: fontSize.base, color: color.ink },
  savedText: { fontFamily: font.body, fontSize: fontSize.sm, color: color.primary },
  mutedSmall: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },

  fieldLabel: { fontFamily: font.bodySemi, fontSize: fontSize.base, color: color.ink },
  errorText: { fontFamily: font.body, fontSize: fontSize.sm, color: color.danger },

  input: { marginTop: space.xs, backgroundColor: color.canvas, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.sm, fontFamily: font.body, fontSize: fontSize.base, color: color.ink },

  rowButtons: { flexDirection: 'row', gap: space.md, flexWrap: 'wrap' },

  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  switchTrack: { width: 44, height: 26, borderRadius: radius.pill, borderWidth: 1, padding: 2, justifyContent: 'center' },
  switchKnob: { width: 20, height: 20, borderRadius: radius.pill, backgroundColor: color.surface },

  footerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap', marginTop: space.sm },
  actionButton: { minHeight: layout.minTouchTarget, borderRadius: radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },
  actionButtonLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm },
});
