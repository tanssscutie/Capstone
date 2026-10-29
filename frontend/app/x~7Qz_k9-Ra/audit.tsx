// app/x~7Qz_k9-Ra/audit.tsx
// Admin audit log (super admins only — GET /business/admin/audit-log): who
// did what, to whom, and when — newest first. Filters: administrator,
// action, period and free text; "Export CSV" downloads the same filtered
// rows (and is itself recorded).
import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { color, font, fontSize, lineHeight, space } from '../../components/ui/tokens';
import { AdminShell, AdminCard, EmptyState, ErrorBanner, FilterChips, GhostButton, LoadingBlock, SearchField, useAdminAccess } from '../../components/ui/AdminKit';
import { auditLogCsvPath, getAuditLog, type AuditLogOut } from '../../lib/api/admin';
import { downloadAuthedFile, errorMessage } from '../../lib/api/client';

type Period = '1' | '7' | '30' | 'all';

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function AdminAuditRoute() {
  const access = useAdminAccess('super');
  const [data, setData] = useState<AuditLogOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adminId, setAdminId] = useState('all');
  const [action, setAction] = useState('all');
  const [period, setPeriod] = useState<Period>('30');
  const [query, setQuery] = useState('');
  const [showActions, setShowActions] = useState(false);
  const [exporting, setExporting] = useState(false);

  const filters = {
    admin_id: adminId === 'all' ? null : Number(adminId),
    action: action === 'all' ? null : action,
    q: query,
    days: period === 'all' ? null : Number(period),
  };
  const key = JSON.stringify(filters);

  const load = useCallback(() => {
    getAuditLog(JSON.parse(key)).then(setData).catch((e) => setError(errorMessage(e, 'Could not load the audit log.')));
  }, [key]);

  useEffect(() => {
    if (access !== 'GRANTED') return;
    const t = setTimeout(load, 250); // typing in search
    return () => clearTimeout(t);
  }, [access, load]);

  async function exportCsv() {
    setExporting(true);
    setError(null);
    try {
      await downloadAuthedFile(auditLogCsvPath(filters), `trustlink-audit-log-${new Date().toISOString().slice(0, 10)}.csv`);
      load();
    } catch (e: any) {
      setError(errorMessage(e, 'Could not export the audit log.'));
    } finally {
      setExporting(false);
    }
  }

  const actionLabel = data?.actions.find((a) => a.value === action)?.label;

  return (
    <AdminShell access={access} title="System settings" subtitle="Audit log (super admins only) — every administrator action, newest first"
      actions={
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <GhostButton label="Export CSV" onPress={exportCsv} busy={exporting} />
          <GhostButton label="Refresh" onPress={load} />
        </View>
      }>
      {error && <ErrorBanner message={error} />}
      {!data ? <LoadingBlock /> : (
        <>
          <SearchField value={query} onChangeText={setQuery} placeholder="Search administrator, business or details" />
          <FilterChips<Period> options={[{ value: '1', label: 'Today' }, { value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: 'all', label: 'All time' }]}
            value={period} onChange={setPeriod} />
          <FilterChips options={[{ value: 'all', label: 'All administrators' }, ...data.admins.map((a) => ({ value: String(a.id), label: a.name }))]}
            value={adminId} onChange={setAdminId} />
          <View style={styles.row}>
            <Text style={styles.muted}>Action: {action === 'all' ? 'all actions' : actionLabel}</Text>
            <Pressable onPress={() => setShowActions((v) => !v)} hitSlop={6}>
              <Text style={styles.link}>{showActions ? 'Hide actions' : 'Pick an action'}</Text>
            </Pressable>
          </View>
          {showActions && (
            <FilterChips options={[{ value: 'all', label: 'All actions' }, ...data.actions]} value={action}
              onChange={(v) => { setAction(v); setShowActions(false); }} />
          )}
          {data.entries.length === 0 ? (
            <EmptyState title="Nothing recorded" body="No administrator action matches these filters." />
          ) : (
            <AdminCard>
              <Text style={styles.muted}>{data.entries.length} entr{data.entries.length === 1 ? 'y' : 'ies'}{data.entries.length >= 500 ? ' (the newest 500 — export for more)' : ''}</Text>
              {data.entries.map((e) => (
                <View key={e.id} style={styles.entry}>
                  <Text style={styles.time}>{when(e.created_at)}</Text>
                  <View style={{ flex: 1, minWidth: 240 }}>
                    <Text style={styles.body}>
                      <Text style={styles.strong}>{e.admin_name}</Text> · {e.action_label}
                      {e.target_name ? <Text> · <Text style={styles.strong}>{e.target_name}</Text></Text> : null}
                    </Text>
                    {!!e.details && <Text style={styles.muted}>{e.details}</Text>}
                  </View>
                </View>
              ))}
            </AdminCard>
          )}
        </>
      )}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md, marginBottom: space.sm },
  entry: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: color.borderFaint },
  time: { width: 210, fontFamily: font.mono, fontSize: fontSize.sm, color: color.inkMuted },
  body: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.ink },
  strong: { fontFamily: font.bodySemi },
  muted: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  link: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.primary },
});
