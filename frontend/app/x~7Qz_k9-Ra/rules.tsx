// app/x~7Qz_k9-Ra/rules.tsx
// Platform rules (super admins only — /business/admin/platform-rules): the
// rules every business runs under, editable here. Each shows its value in
// force and the server's .env default; "Reset" goes back to the default.
// The server validates every value (ranges, on/off, length).
import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { color, font, fontSize, lineHeight, space, radius } from '../../components/ui/tokens';
import { AdminShell, AdminCard, ErrorBanner, GhostButton, LoadingBlock, Pill, useAdminAccess } from '../../components/ui/AdminKit';
import { listPlatformRules, resetPlatformRule, setPlatformRule, type PlatformRule } from '../../lib/api/admin';
import { errorMessage } from '../../lib/api/client';

function show(rule: PlatformRule, value: PlatformRule['value']): string {
  if (rule.type === 'bool') return value ? 'On' : 'Off';
  if (rule.type === 'text') return value ? String(value) : '(empty)';
  return String(value);
}

function RuleRow({ rule, onSaved, onError }: { rule: PlatformRule; onSaved: (rules: PlatformRule[]) => void; onError: (m: string | null) => void }) {
  const [draft, setDraft] = useState(String(rule.value));
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(String(rule.value)), [rule.value]);
  const changed = rule.type !== 'bool' && draft.trim() !== String(rule.value);

  const run = async (call: () => Promise<PlatformRule[]>) => {
    setBusy(true);
    onError(null);
    try {
      onSaved(await call());
    } catch (e: any) {
      onError(errorMessage(e, 'Could not save that rule.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.rule}>
      <View style={styles.row}>
        <View style={{ flex: 1, minWidth: 220 }}>
          <Text style={styles.label}>{rule.label}</Text>
          <Text style={styles.muted}>{rule.help}</Text>
          <Text style={styles.muted}>Default (.env): {show(rule, rule.default)}</Text>
        </View>
        {rule.overridden && <Pill label="Changed" tone="primary" />}
      </View>
      <View style={styles.row}>
        {rule.type === 'bool' ? (
          <Pressable disabled={busy} onPress={() => run(() => setPlatformRule(rule.key, !rule.value))}
            style={[styles.toggle, rule.value ? styles.toggleOn : null]} accessibilityRole="switch" accessibilityState={{ checked: !!rule.value }}>
            <Text style={[styles.toggleLabel, rule.value ? { color: color.onPrimary } : null]}>{rule.value ? 'On' : 'Off'}</Text>
          </Pressable>
        ) : (
          <>
            <TextInput value={draft} onChangeText={setDraft} keyboardType={rule.type === 'int' ? 'number-pad' : 'default'}
              placeholder={rule.type === 'text' ? 'No banner' : undefined} placeholderTextColor={color.inkFaint}
              maxLength={rule.max_length ?? 6} style={[styles.input, rule.type === 'text' ? { flexGrow: 1 } : { width: 110 }]} />
            {rule.type === 'int' && <Text style={styles.muted}>{rule.min}–{rule.max}</Text>}
            <Pressable disabled={busy || !changed} onPress={() => run(() => setPlatformRule(rule.key, draft.trim()))}
              style={[styles.primary, busy || !changed ? { opacity: 0.4 } : null]}>
              <Text style={styles.primaryLabel}>{busy ? 'Saving…' : 'Save'}</Text>
            </Pressable>
          </>
        )}
        {rule.overridden && (
          <Pressable disabled={busy} hitSlop={6} onPress={() => run(() => resetPlatformRule(rule.key))}>
            <Text style={styles.link}>Reset to default</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

export default function AdminRulesRoute() {
  const access = useAdminAccess('super');
  const [rules, setRules] = useState<PlatformRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    listPlatformRules().then(setRules).catch((e) => setError(errorMessage(e, 'Could not load the platform rules.')));
  }, []);
  useEffect(() => { if (access === 'GRANTED') load(); }, [access, load]);

  return (
    <AdminShell access={access} title="System settings" subtitle="Platform rules (super admins only) — changes apply to every business within a few seconds"
      actions={<GhostButton label="Refresh" onPress={load} />}>
      {error && <ErrorBanner message={error} />}
      {rules === null ? <LoadingBlock /> : (
        <AdminCard>
          {rules.map((r, i) => (
            <View key={r.key} style={i > 0 ? styles.divider : null}>
              <RuleRow rule={r} onSaved={setRules} onError={setError} />
            </View>
          ))}
        </AdminCard>
      )}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  rule: { gap: space.sm, paddingVertical: space.md },
  divider: { borderTopWidth: 1, borderTopColor: color.borderFaint },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md },
  label: { fontFamily: font.bodySemi, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.ink },
  muted: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  input: { borderWidth: 1, borderColor: color.border, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, fontFamily: font.body, fontSize: fontSize.sm, color: color.ink, backgroundColor: color.canvas },
  primary: { backgroundColor: color.primary, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  primaryLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.onPrimary },
  link: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.primary },
  toggle: { borderWidth: 1, borderColor: color.border, borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: space.xs, backgroundColor: color.surfaceSunken },
  toggleOn: { backgroundColor: color.primary, borderColor: color.primary },
  toggleLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.inkMuted },
});
