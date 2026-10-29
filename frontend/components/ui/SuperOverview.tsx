// components/ui/SuperOverview.tsx
// The super admin's part of the dashboard (GET /business/admin/super-overview):
// service health and each administrator's workload over the last 30 days.
// Renders nothing for an admin who isn't a super admin.
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { color, font, fontSize, lineHeight, letterSpacing, space, radius } from './tokens';
import { Pill, SectionHeader, timeAgo, type PillTone } from './AdminKit';
import { getSuperOverview, type ServiceCheck, type SuperOverview as Overview } from '../../lib/api/admin';
import { useAdminRole } from '../../lib/useAdminRole';

const STATUS: Record<ServiceCheck['status'], { label: string; tone: PillTone }> = {
  ok: { label: 'OK', tone: 'primary' },
  warning: { label: 'Check', tone: 'neutral' },
  off: { label: 'Off', tone: 'neutral' },
  down: { label: 'Down', tone: 'danger' },
};

function hours(h: number | null): string {
  if (h == null) return '—';
  return h >= 48 ? `${Math.round(h / 24)}d` : `${Math.round(h)}h`;
}

export function SuperOverview({ refreshKey }: { refreshKey?: number }) {
  const role = useAdminRole();
  const [data, setData] = useState<Overview | null>(null);

  useEffect(() => {
    if (role !== 'super_admin') return;
    getSuperOverview().then(setData).catch(() => setData(null));
  }, [role, refreshKey]);

  if (role !== 'super_admin' || !data) return null;
  const problems = data.health.filter((c) => c.status === 'down').length;

  return (
    <View style={{ marginBottom: space.lg }}>
      <SectionHeader title="Super admin" caption={problems ? `${problems} service${problems === 1 ? '' : 's'} down` : 'Service health and the admin team’s workload'} />
      <View style={styles.grid}>
        <View style={styles.panel}>
          <Text style={styles.label}>Service health</Text>
          {data.health.map((c) => (
            <View key={c.name} style={styles.check}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.name}>{c.name}</Text>
                <Text style={styles.muted}>{c.detail}</Text>
              </View>
              <Pill label={STATUS[c.status].label} tone={STATUS[c.status].tone} />
            </View>
          ))}
        </View>
        <View style={styles.panel}>
          <Text style={styles.label}>Admin workload · last {data.window_days} days</Text>
          <View style={[styles.tr, styles.thRow]}>
            {['Administrator', 'Verif.', 'Reports', 'Changes', 'Avg review', 'Last action'].map((h, i) => (
              <Text key={h} style={[styles.th, i === 0 ? styles.first : styles.cell]}>{h}</Text>
            ))}
          </View>
          {data.workload.map((w) => (
            <View key={w.id} style={styles.tr}>
              <Text style={[styles.td, styles.first]} numberOfLines={1}>
                {w.name}{w.admin_role === 'super_admin' ? ' ★' : ''}{w.is_active ? '' : ' (disabled)'}
              </Text>
              <Text style={[styles.td, styles.cell]}>{w.verifications}</Text>
              <Text style={[styles.td, styles.cell]}>{w.reports}</Text>
              <Text style={[styles.td, styles.cell]}>{w.change_requests}</Text>
              <Text style={[styles.td, styles.cell]}>{hours(w.avg_review_hours)}</Text>
              <Text style={[styles.td, styles.cell]}>{w.last_action_at ? timeAgo(w.last_action_at) : '—'}</Text>
            </View>
          ))}
          <Text style={styles.muted}>★ super admin. Avg review = submission to decision.</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  panel: { flexGrow: 1, flexBasis: 360, gap: space.sm, backgroundColor: color.surface, borderWidth: 1, borderColor: color.border, borderRadius: radius.xl, padding: space.xl },
  label: { fontFamily: font.monoMedium, fontSize: fontSize.micro, lineHeight: lineHeight.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.inkMuted },
  check: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs, borderTopWidth: 1, borderTopColor: color.borderFaint },
  name: { fontFamily: font.bodySemi, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.ink },
  muted: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  tr: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.xs, borderTopWidth: 1, borderTopColor: color.borderFaint },
  thRow: { borderTopWidth: 0 },
  th: { fontFamily: font.monoMedium, fontSize: fontSize.micro, color: color.inkFaint },
  td: { fontFamily: font.body, fontSize: fontSize.sm, color: color.ink },
  first: { flex: 2, minWidth: 0 },
  cell: { flex: 1, textAlign: 'right' },
});
