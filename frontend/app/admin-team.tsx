// app/admin-team.tsx
// Admin team (super admins only — GET/POST /business/admin/team): every
// administrator account; create one, promote or demote, disable or re-enable,
// and reset a password (the temporary one is shown once, to hand over). The
// server refuses to demote or disable the last active super admin, and an
// admin can't disable their own account.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { color, font, fontSize, lineHeight, letterSpacing, space, radius } from '../components/ui/tokens';
import { AdminShell, AdminCard, ErrorBanner, FilterChips, GhostButton, LoadingBlock, Pill, SectionHeader, formatDate, useAdminAccess } from '../components/ui/AdminKit';
import {
  createAdminMember, getAdminMe, listAdminTeam, resetAdminPassword, setAdminActive, setAdminRole,
  type AdminRole, type AdminTeamMember,
} from '../lib/api/admin';
import { errorMessage } from '../lib/api/client';

function CreateCard({ onCreated, onError }: { onCreated: () => void; onError: (m: string | null) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<AdminRole>('admin');
  const [busy, setBusy] = useState(false);
  const ready = !busy && name.trim().length >= 2 && email.includes('@') && password.length >= 8;

  async function create() {
    if (!ready) return;
    setBusy(true);
    onError(null);
    try {
      await createAdminMember({ name: name.trim(), email: email.trim(), password, role });
      setName('');
      setEmail('');
      setPassword('');
      setRole('admin');
      onCreated();
    } catch (e: any) {
      onError(errorMessage(e, 'Could not create that administrator.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminCard>
      <Text style={styles.cardTitle}>Add an administrator</Text>
      <Text style={styles.muted}>They sign in at /admin-login with this email and password. Share the password privately.</Text>
      <View style={styles.formRow}>
        <TextInput value={name} onChangeText={setName} placeholder="Full name" placeholderTextColor={color.inkFaint} style={styles.input} maxLength={120} />
        <TextInput value={email} onChangeText={setEmail} placeholder="Email" placeholderTextColor={color.inkFaint} style={styles.input}
          autoCapitalize="none" keyboardType="email-address" maxLength={200} />
        <TextInput value={password} onChangeText={setPassword} placeholder="Password (8+ characters)" placeholderTextColor={color.inkFaint}
          style={styles.input} secureTextEntry maxLength={200} />
      </View>
      <View style={styles.row}>
        <FilterChips<AdminRole> options={[{ value: 'admin', label: 'Admin' }, { value: 'super_admin', label: 'Super admin' }]} value={role} onChange={setRole} />
        <View style={{ flex: 1 }} />
        <Pressable onPress={create} disabled={!ready} style={[styles.primary, !ready ? { opacity: 0.4 } : null]} accessibilityRole="button">
          <Text style={styles.primaryLabel}>{busy ? 'Adding…' : 'Add administrator'}</Text>
        </Pressable>
      </View>
    </AdminCard>
  );
}

function MemberRow({ m, isMe, onChanged, onError }: { m: AdminTeamMember; isMe: boolean; onChanged: () => void; onError: (msg: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [temporary, setTemporary] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const superAdmin = m.admin_role === 'super_admin';

  const run = async (call: () => Promise<unknown>) => {
    setBusy(true);
    onError(null);
    try {
      await call();
      onChanged();
    } catch (e: any) {
      onError(errorMessage(e, 'Could not save that change.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.member}>
      <View style={styles.row}>
        <View style={{ flex: 1, minWidth: 200 }}>
          <Text style={styles.name}>{m.name}{isMe ? ' (you)' : ''}</Text>
          <Text style={styles.muted}>{m.email ?? '—'} · added {formatDate(m.created_at)}</Text>
        </View>
        <Pill label={superAdmin ? 'Super admin' : 'Admin'} tone={superAdmin ? 'solid' : 'neutral'} />
        {!m.is_active && <Pill label="Disabled" tone="danger" />}
      </View>
      <View style={styles.row}>
        <Pressable disabled={busy} hitSlop={6} onPress={() => run(() => setAdminRole(m.id, superAdmin ? 'admin' : 'super_admin'))}>
          <Text style={styles.link}>{superAdmin ? 'Make admin' : 'Make super admin'}</Text>
        </Pressable>
        {!isMe && (
          <Pressable disabled={busy} hitSlop={6} onPress={() => run(() => setAdminActive(m.id, !m.is_active))}>
            <Text style={m.is_active ? styles.dangerLink : styles.link}>{m.is_active ? 'Disable' : 'Enable'}</Text>
          </Pressable>
        )}
        {confirmReset ? (
          <>
            <Pressable disabled={busy} hitSlop={6} onPress={() => run(async () => {
              const r = await resetAdminPassword(m.id);
              setTemporary(r.temporary_password);
              setConfirmReset(false);
            })}>
              <Text style={styles.dangerLink}>Reset now</Text>
            </Pressable>
            <Pressable hitSlop={6} onPress={() => setConfirmReset(false)}><Text style={styles.link}>Cancel</Text></Pressable>
          </>
        ) : (
          <Pressable disabled={busy} hitSlop={6} onPress={() => { setTemporary(null); setConfirmReset(true); }}>
            <Text style={styles.link}>Reset password</Text>
          </Pressable>
        )}
      </View>
      {temporary && (
        <View style={styles.tempBox}>
          <Text style={styles.muted}>Temporary password — shown once. Give it to {m.name} privately; they can change it in Settings.</Text>
          <Text selectable style={styles.tempValue}>{temporary}</Text>
        </View>
      )}
    </View>
  );
}

export default function AdminTeamRoute() {
  const access = useAdminAccess('super');
  const [team, setTeam] = useState<AdminTeamMember[] | null>(null);
  const [meId, setMeId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    listAdminTeam().then(setTeam).catch((e) => setError(errorMessage(e, 'Could not load the admin team.')));
  }, []);

  useEffect(() => {
    if (access !== 'GRANTED') return;
    load();
    getAdminMe().then((m) => setMeId(m.id)).catch(() => {});
  }, [access, load]);

  const supers = team?.filter((m) => m.admin_role === 'super_admin' && m.is_active).length ?? 0;

  return (
    <AdminShell access={access} title="Admin team" subtitle="Super admins only — who can sign in to the admin console"
      actions={<GhostButton label="Refresh" onPress={load} />}>
      {error && <ErrorBanner message={error} />}
      <CreateCard onCreated={load} onError={setError} />
      <SectionHeader title="Administrators" caption={team ? `${team.length} account${team.length === 1 ? '' : 's'} · ${supers} active super admin${supers === 1 ? '' : 's'} (there is always at least one)` : undefined} />
      {team === null ? <LoadingBlock /> : (
        <AdminCard>
          {team.map((m, i) => (
            <View key={m.id} style={i > 0 ? styles.divider : null}>
              <MemberRow m={m} isMe={m.id === meId} onChanged={load} onError={setError} />
            </View>
          ))}
        </AdminCard>
      )}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  cardTitle: { fontFamily: font.bodySemi, fontSize: fontSize.md, lineHeight: lineHeight.md, color: color.ink },
  name: { fontFamily: font.bodySemi, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.ink },
  muted: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md },
  formRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  input: { flexGrow: 1, flexBasis: 200, borderWidth: 1, borderColor: color.border, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, fontFamily: font.body, fontSize: fontSize.sm, color: color.ink, backgroundColor: color.canvas },
  primary: { backgroundColor: color.primary, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  primaryLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.onPrimary },
  link: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.primary },
  dangerLink: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.danger },
  member: { gap: space.sm, paddingVertical: space.md },
  divider: { borderTopWidth: 1, borderTopColor: color.borderFaint },
  tempBox: { gap: space.xs, borderWidth: 1, borderColor: color.warningBorder, backgroundColor: color.warningFaint, borderRadius: radius.md, padding: space.md },
  tempValue: { fontFamily: font.monoMedium, fontSize: fontSize.md, letterSpacing: letterSpacing.label, color: color.ink },
});
