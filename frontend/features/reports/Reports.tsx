// features/reports/Reports.tsx
// "Reports" — report a business that's breaking TrustLink's rules (fake
// listings, scams, bid manipulation…), and follow what happened to the
// reports you filed. An administrator reviews each one and can warn, suspend
// or ban the account. Same page shell as HelpSupport.tsx.
// Order: search → businesses you've dealt with → "Your reports (N)", which
// opens MyReports on its own page (/my-reports).
import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, useWindowDimensions } from 'react-native';
import ScreenScroll from '../../components/ui/ScreenScroll';
import { color, font, fontSize, lineHeight, letterSpacing, space, radius, elevation, layout, breakpoint } from '../../components/ui/tokens';
import { ReportBusinessModal } from '../../components/ui/ReportBusinessModal';
import type { BusinessSearchOut, MyReportOut, ReportSuggestionOut } from '../../lib/api/business';
import { BusinessNameLink } from '../../components/ui/BusinessLink';

export interface ReportsProps {
  reports: MyReportOut[];
  /** Businesses you've transacted with — shown first so you don't have to search. */
  suggestions?: ReportSuggestionOut[];
  /** Resolves to the matches, or throws (e.g. 403 for an unverified account). */
  onSearch: (q: string) => Promise<BusinessSearchOut[]>;
  /** A report was sent — reload the list. */
  onReported?: () => void;
  /** Opens /my-reports. */
  onOpenMyReports?: () => void;
  onBack?: () => void;
}

const STATUS: Record<MyReportOut['status'], { label: string; tone: 'open' | 'done' | 'neutral' }> = {
  open: { label: 'Under review', tone: 'open' },
  resolved: { label: 'Action taken', tone: 'done' },
  dismissed: { label: 'No violation found', tone: 'neutral' },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function Reports({ reports, suggestions = [], onSearch, onReported, onOpenMyReports, onBack }: ReportsProps) {
  const { width } = useWindowDimensions();
  const isWide = width >= breakpoint.desktop;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<BusinessSearchOut[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [target, setTarget] = useState<BusinessSearchOut | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearchError(null);
      return;
    }
    debounce.current = setTimeout(async () => {
      setSearching(true);
      try {
        setResults(await onSearch(q));
        setSearchError(null);
      } catch (e: any) {
        setResults([]);
        setSearchError(e?.status === 403 ? 'Only verified accounts can report a business.' : 'Search failed. Try again.');
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <ScreenScroll style={styles.root} contentContainerStyle={styles.scrollContent}>
      <View style={isWide ? styles.pageWide : styles.page}>
        {onBack && (
          <Pressable onPress={onBack} hitSlop={6} style={{ alignSelf: 'flex-start' }}>
            <Text style={styles.backLink}>← Back</Text>
          </Pressable>
        )}
        <View style={{ gap: space.xs }}>
          <Text style={styles.heroName}>Reports</Text>
          <Text style={styles.muted}>
            Report a business that's breaking the rules. An administrator reviews every report — serious or repeated
            violations lead to a suspension or a ban. The business is never told who reported them.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Report a business</Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search a business by name"
            placeholderTextColor={color.inkFaint}
            style={styles.input}
          />
          {searching && <ActivityIndicator color={color.primary} style={{ marginTop: space.sm }} />}
          {searchError && <Text style={styles.error}>{searchError}</Text>}
          {!searching && !searchError && query.trim().length >= 2 && results.length === 0 && (
            <Text style={styles.muted}>No business matches "{query.trim()}".</Text>
          )}
          {results.map((b) => (
            <Pressable key={b.id} onPress={() => setTarget(b)} style={({ pressed }) => [styles.resultRow, pressed ? styles.pressed : null]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <BusinessNameLink businessId={b.id} name={b.name} style={styles.resultName} numberOfLines={1} />
                <Text style={styles.muted} numberOfLines={1}>
                  {[b.role === 'buyer' ? 'Buyer' : b.role === 'seller' ? 'Seller' : null, b.category, b.city].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Text style={styles.reportLink}>Report</Text>
            </Pressable>
          ))}
          <Text style={[styles.muted, { marginTop: space.sm }]}>
            You can also report a business from its profile, from a quotation, or from the award chat.
          </Text>
        </View>

        {suggestions.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Businesses you've dealt with</Text>
            {suggestions.map((b) => (
              <Pressable key={b.id} onPress={() => setTarget(b)} style={({ pressed }) => [styles.resultRow, pressed ? styles.pressed : null]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <BusinessNameLink businessId={b.id} name={b.name} style={styles.resultName} numberOfLines={1} />
                  <Text style={styles.muted} numberOfLines={1}>
                    {b.relation === 'supplier' ? 'Quoted on' : 'You quoted on'} {b.context}
                  </Text>
                </View>
                <Text style={styles.reportLink}>Report</Text>
              </Pressable>
            ))}
          </View>
        )}

        <Pressable
          onPress={onOpenMyReports}
          style={({ pressed }) => [styles.myReportsButton, pressed ? styles.pressed : null]}
          accessibilityRole="button"
        >
          <Text style={styles.myReportsLabel}>Your reports ({reports.length})</Text>
          <Text style={styles.myReportsArrow}>→</Text>
        </Pressable>
      </View>

      {target && (
        <ReportBusinessModal
          businessId={target.id}
          businessName={target.name}
          onClose={() => {
            setTarget(null);
            onReported?.();
          }}
        />
      )}
    </ScreenScroll>
  );
}

/** The reports you filed and what happened to each — /my-reports. */
export function MyReports({ reports, loading, onBack }: { reports: MyReportOut[]; loading?: boolean; onBack?: () => void }) {
  const { width } = useWindowDimensions();
  const isWide = width >= breakpoint.desktop;
  return (
    <ScreenScroll style={styles.root} contentContainerStyle={styles.scrollContent}>
      <View style={isWide ? styles.pageWide : styles.page}>
        {onBack && (
          <Pressable onPress={onBack} hitSlop={6} style={{ alignSelf: 'flex-start' }}>
            <Text style={styles.backLink}>← Reports</Text>
          </Pressable>
        )}
        <View style={{ gap: space.xs }}>
          <Text style={styles.heroName}>Your reports</Text>
          <Text style={styles.muted}>Every report you filed and what the administrator decided. The business is never told who reported them.</Text>
        </View>
        <View style={styles.card}>
          {loading ? (
            <ActivityIndicator color={color.primary} />
          ) : reports.length === 0 ? (
            <Text style={styles.muted}>You haven't reported anyone.</Text>
          ) : (
            reports.map((r) => {
              const st = STATUS[r.status];
              return (
                <View key={r.id} style={styles.reportRow}>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text style={styles.resultName} numberOfLines={1}>{r.reported_name}</Text>
                    <Text style={styles.muted}>{r.reason_label} · {formatDate(r.created_at)}</Text>
                  </View>
                  <View style={[styles.pill, st.tone === 'open' ? styles.pillOpen : st.tone === 'done' ? styles.pillDone : null]}>
                    <Text style={[styles.pillLabel, st.tone === 'open' ? { color: color.danger } : st.tone === 'done' ? { color: color.primary } : null]}>
                      {st.label}
                    </Text>
                  </View>
                </View>
              );
            })
          )}
        </View>
      </View>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  scrollContent: { alignItems: 'center', paddingVertical: space.lg, paddingBottom: space.xxl },
  page: { width: '100%', maxWidth: layout.maxWidth, paddingHorizontal: layout.screenPadding, gap: space.lg },
  pageWide: { width: '100%', maxWidth: 720, paddingHorizontal: layout.screenPadding, gap: space.lg },
  backLink: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.primary },
  heroName: { fontFamily: font.display, fontSize: fontSize.display, lineHeight: lineHeight.display, letterSpacing: letterSpacing.tight, color: color.ink },
  muted: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  card: { ...elevation.cardRaised, borderRadius: radius.xl, backgroundColor: color.surface, padding: space.lg, gap: space.sm },
  sectionLabel: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.inkFaint },
  input: { minHeight: layout.minTouchTarget, borderWidth: 1, borderColor: color.border, borderRadius: radius.md, paddingHorizontal: space.md, fontFamily: font.body, fontSize: fontSize.base, color: color.ink, backgroundColor: color.canvas },
  error: { fontFamily: font.body, fontSize: fontSize.sm, color: color.danger },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: color.borderFaint },
  pressed: { opacity: 0.7 },
  myReportsButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: layout.minTouchTarget, borderWidth: 1, borderColor: color.border, borderRadius: radius.pill, paddingHorizontal: space.lg, backgroundColor: color.surface },
  myReportsLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.ink },
  myReportsArrow: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.primary },
  resultName: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.ink },
  reportLink: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.danger },
  reportRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: color.borderFaint },
  pill: { borderRadius: radius.pill, borderWidth: 1, borderColor: color.border, paddingHorizontal: space.md, paddingVertical: 2 },
  pillOpen: { borderColor: color.dangerBorder },
  pillDone: { borderColor: color.primaryBorder, backgroundColor: color.primaryFaint },
  pillLabel: { fontFamily: font.mono, fontSize: 10, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.inkMuted },
});
