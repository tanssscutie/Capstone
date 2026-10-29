// app/admin-settings.tsx
// Admin Settings: the admin's own account (appearance — light/dark/system —
// and password), and a read-only view of the platform rules in force and
// which services are switched on (GET /business/admin/system-status). The
// rules default to the server's .env; super admins change them on the
// Platform rules page (admin-rules.tsx), so they're only shown here. Same shell as the other admin pages.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { color, font, fontSize, lineHeight, letterSpacing, space } from '../components/ui/tokens';
import { AdminShell, AdminCard, ErrorBanner, GhostButton, InfoGrid, LoadingBlock, Pill, useAdminAccess } from '../components/ui/AdminKit';
import { AppearanceCard, PasswordCard } from '../features/settings/AccountSettings';
import { getSystemStatus, type AdminSystemStatus } from '../lib/api/admin';
import { changePassword, logout, me, requestPasswordChangeOtp, updateTheme, type BackendUser } from '../lib/api/auth';
import { errorMessage } from '../lib/api/client';

function StatusRow({ label, on, onText, offText, detail }: { label: string; on: boolean; onText: string; offText: string; detail: string }) {
  return (
    <View style={styles.statusRow}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.statusLabel}>{label}</Text>
        <Text style={styles.muted}>{detail}</Text>
      </View>
      <Pill label={on ? onText : offText} tone={on ? 'primary' : 'danger'} />
    </View>
  );
}

export default function AdminSettingsRoute() {
  const access = useAdminAccess();
  const router = useRouter();
  const [user, setUser] = useState<BackendUser | null>(null);
  const [status, setStatus] = useState<AdminSystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, s] = await Promise.all([me(), getSystemStatus()]);
      setUser(u);
      setStatus(s);
    } catch (e: any) {
      setError(errorMessage(e, 'Could not load the settings.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (access === 'GRANTED') load();
  }, [access, load]);

  return (
    <AdminShell
      access={access}
      title="Settings"
      subtitle="Your admin account, and how the platform is set up."
      actions={<GhostButton label="Refresh" onPress={load} busy={loading} />}
    >
      {error && <ErrorBanner message={error} />}
      {loading && !user ? (
        <LoadingBlock />
      ) : user && (
        <View style={{ gap: space.lg }}>
          <AppearanceCard
            theme={user.theme ?? 'system'}
            onChangeTheme={async (theme) => {
              setUser(await updateTheme(theme));
            }}
          />

          <AdminCard>
            <Text style={styles.sectionLabel}>Admin account</Text>
            <InfoGrid
              items={[
                { label: 'Name', value: user.business_name || 'Administrator' },
                { label: 'Email', value: user.email ?? '—' },
                { label: 'Access', value: 'Full access' },
              ]}
            />
            <View style={styles.footer}>
              <GhostButton
                label="Log out"
                onPress={() => {
                  logout();
                  router.replace('/admin-login');
                }}
              />
            </View>
          </AdminCard>

          <PasswordCard
            email={user.email}
            availableAt={user.password_change_available_at ?? null}
            onRequestPasswordOtp={requestPasswordChangeOtp}
            onChangePassword={async (currentPassword, newPassword, code) => {
              await changePassword(currentPassword, newPassword, code);
              setUser(await me());
            }}
          />

          {status && (
            <>
              <AdminCard>
                <Text style={styles.sectionLabel}>Platform rules</Text>
                <Text style={styles.muted}>In force for every business. The defaults come from the server configuration (.env); a super admin can change them under Platform rules.</Text>
                <InfoGrid
                  items={[
                    { label: 'Quotations needed to open', value: `${status.min_quotations_to_release}` },
                    { label: 'Extension when short', value: `${status.auto_extend_days} days, once` },
                    { label: 'Withdrawal window', value: `${status.withdrawal_window_days} days` },
                    { label: 'Withdrawal steps', value: 'Warning → suspension review → ban review' },
                  ]}
                />
              </AdminCard>

              <AdminCard>
                <Text style={styles.sectionLabel}>Services</Text>
                <StatusRow
                  label="AI features (Gemini)"
                  on={status.ai_enabled}
                  onText="On"
                  offText="Off"
                  detail="Document checks and ID reading, category suggestions, Write with AI and Draft with AI. Off: uploads are accepted as “not auto-checked”."
                />
                <StatusRow
                  label="Email delivery"
                  on={status.email_enabled}
                  onText="Sending"
                  offText="Dev mode"
                  detail="Sign-in codes and important alerts. Dev mode prints them to the server log instead of sending."
                />
                <StatusRow
                  label="Files encrypted at rest"
                  on={status.files_encrypted}
                  onText="On"
                  offText="Off"
                  detail="Verification documents, attachments and withdrawal proofs are stored encrypted."
                />
              </AdminCard>
            </>
          )}
        </View>
      )}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontFamily: font.mono,
    fontSize: fontSize.micro,
    letterSpacing: letterSpacing.label,
    textTransform: 'uppercase',
    color: color.inkFaint,
    marginBottom: space.sm,
  },
  muted: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted, marginBottom: space.sm },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: color.borderFaint },
  statusLabel: { fontFamily: font.bodySemi, fontSize: fontSize.base, color: color.ink },
  footer: { flexDirection: 'row', marginTop: space.md },
});
