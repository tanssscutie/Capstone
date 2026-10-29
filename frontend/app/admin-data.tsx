// app/admin-data.tsx
// Backups & exports (super admins only). "Run backup now" runs the server's
// backup script (database + encrypted uploads into backend/backups/); the
// folders are listed here but never downloadable — they hold personal data
// and stay on the server. CSV exports: users, requirements, ledger — never
// sealed content (no quotation figures; the ledger without payloads).
import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { color, font, fontSize, lineHeight, space, radius } from '../components/ui/tokens';
import { AdminShell, AdminCard, EmptyState, ErrorBanner, LoadingBlock, SectionHeader, useAdminAccess } from '../components/ui/AdminKit';
import { listBackups, runBackup, type BackupFolder, type ExportKind } from '../lib/api/admin';
import { downloadAuthedFile, errorMessage } from '../lib/api/client';

const EXPORTS: { kind: ExportKind; title: string; body: string }[] = [
  { kind: 'users', title: 'Users', body: 'Every account: names, role, contact, location, verification, tier and restrictions. No passwords.' },
  { kind: 'requirements', title: 'Requirements', body: 'Every posting: buyer, category, city, budget, status, number of quotations and who won. No quotation figures.' },
  { kind: 'ledger', title: 'Ledger', body: 'Every ledger entry: event, requirement, actor, time and the hash chain. Payloads left out.' },
];

function formatSize(bytes: number): string {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

function folderDate(name: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})$/.exec(name);
  if (!m) return name;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function AdminDataRoute() {
  const access = useAdminAccess('super');
  const [backups, setBackups] = useState<BackupFolder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [exporting, setExporting] = useState<ExportKind | null>(null);

  const load = useCallback(() => {
    listBackups().then(setBackups).catch((e) => setError(errorMessage(e, 'Could not list the backups.')));
  }, []);
  useEffect(() => { if (access === 'GRANTED') load(); }, [access, load]);

  async function backup() {
    setRunning(true);
    setError(null);
    setNotice(null);
    try {
      const r = await runBackup();
      setNotice(`Backup ${r.name} written: ${r.size_mb} MB, ${r.uploaded_files} uploaded files.`);
      load();
    } catch (e: any) {
      setError(errorMessage(e, 'The backup failed.'));
    } finally {
      setRunning(false);
    }
  }

  async function exportCsv(kind: ExportKind) {
    setExporting(kind);
    setError(null);
    try {
      await downloadAuthedFile(`/business/admin/export/${kind}.csv`, `trustlink-${kind}-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (e: any) {
      setError(errorMessage(e, 'Could not export that file.'));
    } finally {
      setExporting(null);
    }
  }

  return (
    <AdminShell access={access} title="Backups & exports" subtitle="Super admins only — every backup and export goes on the audit log">
      {error && <ErrorBanner message={error} />}

      <SectionHeader title="Backups" caption="Database + encrypted uploads, written to backend/backups/ on the server" />
      <AdminCard>
        <View style={styles.row}>
          <View style={{ flex: 1, minWidth: 240 }}>
            <Text style={styles.body}>Backups stay on the server and are never downloadable here. Restoring needs the server's file encryption key, kept separately.</Text>
            {notice && <Text style={[styles.body, { color: color.primary, marginTop: space.xs }]}>{notice}</Text>}
          </View>
          <Pressable onPress={backup} disabled={running} style={[styles.primary, running ? { opacity: 0.5 } : null]} accessibilityRole="button">
            <Text style={styles.primaryLabel}>{running ? 'Backing up…' : 'Run backup now'}</Text>
          </Pressable>
        </View>
        {backups === null ? <LoadingBlock /> : backups.length === 0 ? (
          <EmptyState title="No backups yet" body="Run the first one above." />
        ) : backups.map((b) => (
          <View key={b.name} style={styles.item}>
            <Text style={styles.strong}>{folderDate(b.name)}</Text>
            <Text style={styles.muted}>{b.name} · {b.files.join(', ')} · {formatSize(b.size_bytes)}</Text>
          </View>
        ))}
      </AdminCard>

      <SectionHeader title="CSV exports" caption="Opens in Excel or Google Sheets" />
      <View style={styles.grid}>
        {EXPORTS.map((x) => (
          <View key={x.kind} style={styles.card}>
            <Text style={styles.strong}>{x.title}</Text>
            <Text style={styles.muted}>{x.body}</Text>
            <Pressable onPress={() => exportCsv(x.kind)} disabled={exporting !== null} style={[styles.secondary, exporting === x.kind ? { opacity: 0.5 } : null]}>
              <Text style={styles.secondaryLabel}>{exporting === x.kind ? 'Preparing…' : `Download ${x.kind}.csv`}</Text>
            </Pressable>
          </View>
        ))}
      </View>
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md },
  body: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.ink },
  strong: { fontFamily: font.bodySemi, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.ink },
  muted: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  item: { paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: color.borderFaint },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  card: { flexGrow: 1, flexBasis: 260, gap: space.sm, backgroundColor: color.surface, borderWidth: 1, borderColor: color.border, borderRadius: radius.xl, padding: space.xl },
  primary: { backgroundColor: color.primary, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  primaryLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.onPrimary },
  secondary: { alignSelf: 'flex-start', borderWidth: 1, borderColor: color.border, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.sm, backgroundColor: color.canvas },
  secondaryLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.ink },
});
