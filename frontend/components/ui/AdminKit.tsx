// components/ui/AdminKit.tsx
// Shared building blocks for the three admin screens (dashboard, businesses,
// requirements): the access gate + page shell, and the small pieces each of
// them used to hand-roll separately — status pills, search, filter chips,
// info grids, document rows and the approve/reject panel.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { color, font, fontSize, lineHeight, letterSpacing, space, radius, layout, breakpoint, applyTheme } from './tokens';
import { AdminSidebar, AdminMobileNav, AdminSectionTabs } from './AdminSidebar';
import { checkAdminAccess, openAdminDocumentFile } from '../../lib/api/admin';
import type { DocumentUploadOut } from '../../lib/api/business';
import { logout, me } from '../../lib/api/auth';
import { loadAdminRole } from '../../lib/useAdminRole';
import { ADMIN } from '../../lib/adminRoutes';

/* ─── Access gate ───────────────────────────────────── */

export type AdminAccess = 'CHECKING' | 'GRANTED' | 'DENIED';

/** Checks is_admin once on mount; a non-admin is sent to /admin-login. With
 *  'super', an admin who isn't a super admin is sent back to the dashboard. */
export function useAdminAccess(level: 'admin' | 'super' = 'admin'): AdminAccess {
  const router = useRouter();
  const [access, setAccess] = useState<AdminAccess>('CHECKING');
  useEffect(() => {
    let cancelled = false;
    checkAdminAccess().then(async (isAdmin) => {
      const ok = isAdmin && (level === 'admin' || (await loadAdminRole()) === 'super_admin');
      if (cancelled) return;
      setAccess(ok ? 'GRANTED' : 'DENIED');
      if (!ok) router.replace(isAdmin ? ADMIN.dashboard : ADMIN.login);
      // The app layout skips admin routes, so the admin's own Light/Dark
      // choice (admin Settings) is applied here.
      if (ok) me().then((u) => !cancelled && applyTheme(u.theme)).catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, [router, level]);
  return access;
}

/* ─── Formatting ────────────────────────────────────── */

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return formatDate(iso);
}

/* ─── Page shell ────────────────────────────────────── */

export function AdminShell({
  access,
  title,
  subtitle,
  actions,
  children,
}: {
  access: AdminAccess;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = width >= breakpoint.desktop;

  if (access === 'CHECKING') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={color.primary} />
      </View>
    );
  }
  if (access === 'DENIED') return null; // redirecting

  function handleLogout() {
    logout();
    router.replace(ADMIN.login);
  }

  return (
    <View style={styles.root}>
      {isDesktop && <AdminSidebar onLogout={handleLogout} />}
      <View style={styles.main}>
        {!isDesktop && <AdminMobileNav onLogout={handleLogout} />}
        <ScrollView style={styles.screen} contentContainerStyle={[styles.content, !isDesktop && styles.contentPhone]}>
          <View style={styles.pageHeader}>
            <View style={styles.pageHeaderText}>
              <Text style={styles.eyebrow}>TrustLink Admin</Text>
              <Text style={[styles.title, !isDesktop && styles.titlePhone]}>{title}</Text>
              {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
            </View>
            {actions}
          </View>
          <AdminSectionTabs />
          {children}
        </ScrollView>
      </View>
    </View>
  );
}

/* ─── Small pieces ──────────────────────────────────── */

export type PillTone = 'primary' | 'danger' | 'neutral' | 'solid';

export function Pill({ label, tone = 'neutral' }: { label: string; tone?: PillTone }) {
  return (
    <View
      style={[
        styles.pill,
        tone === 'primary' && styles.pillPrimary,
        tone === 'danger' && styles.pillDanger,
        tone === 'neutral' && styles.pillNeutral,
        tone === 'solid' && styles.pillSolid,
      ]}
    >
      {tone !== 'neutral' && tone !== 'solid' && (
        <View style={[styles.pillDot, { backgroundColor: tone === 'primary' ? color.primary : color.danger }]} />
      )}
      <Text
        style={[
          styles.pillLabel,
          tone === 'primary' && { color: color.primary },
          tone === 'danger' && { color: color.danger },
          tone === 'neutral' && { color: color.inkMuted },
          tone === 'solid' && { color: color.onPrimary },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

export function GhostButton({ label, onPress, busy = false }: { label: string; onPress: () => void; busy?: boolean }) {
  return (
    <Pressable
      onPress={busy ? undefined : onPress}
      style={({ pressed }) => [styles.ghostButton, pressed && styles.ghostButtonPressed, busy && styles.disabled]}
    >
      {busy ? <ActivityIndicator size="small" color={color.primary} /> : <Text style={styles.ghostButtonLabel}>{label}</Text>}
    </Pressable>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <View style={styles.errorBanner}>
      <View style={styles.errorDot} />
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

export function SectionHeader({ title, caption, right }: { title: string; caption?: string; right?: ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {!!caption && <Text style={styles.sectionCaption}>{caption}</Text>}
      </View>
      {right}
    </View>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyRing}>
        <View style={styles.emptyRingInner} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {!!body && <Text style={styles.emptyBody}>{body}</Text>}
    </View>
  );
}

export function LoadingBlock() {
  return (
    <View style={styles.loadingBlock}>
      <ActivityIndicator color={color.primary} />
    </View>
  );
}

export function AdminCard({ children, highlight = false }: { children: ReactNode; highlight?: boolean }) {
  return <View style={[styles.card, highlight && styles.cardHighlight]}>{children}</View>;
}

export function SearchField({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
}) {
  return (
    <View style={styles.searchField}>
      <View style={styles.searchGlyph}>
        <View style={styles.searchGlyphRing} />
        <View style={styles.searchGlyphHandle} />
      </View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={color.inkFaint}
        style={styles.searchInput}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {value.length > 0 && (
        <Pressable onPress={() => onChangeText('')} hitSlop={8}>
          <Text style={styles.searchClear}>Clear</Text>
        </Pressable>
      )}
    </View>
  );
}

export function FilterChips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.chipRow}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} style={[styles.chip, active && styles.chipActive]}>
            <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{o.label}</Text>
            {o.count !== undefined && (
              <View style={[styles.chipCount, active && styles.chipCountActive]}>
                <Text style={[styles.chipCountLabel, active && styles.chipCountLabelActive]}>{o.count}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Label/value pairs that wrap into as many columns as fit. */
export function InfoGrid({ items }: { items: { label: string; value: string }[] }) {
  return (
    <View style={styles.infoGrid}>
      {items.map((it) => (
        <View key={it.label} style={styles.infoItem}>
          <Text style={styles.infoLabel}>{it.label}</Text>
          <Text style={styles.infoValue} numberOfLines={2}>
            {it.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

/* ─── Documents + review ────────────────────────────── */

export const DOC_TYPE_LABELS: Record<string, string> = {
  DTI: 'DTI Certificate',
  SEC: 'SEC Certificate',
  BIR: 'BIR Certificate',
  MAYORS_PERMIT: "Mayor's / Business Permit",
};

function DocGlyph({ tone }: { tone: string }) {
  return (
    <View style={[styles.docGlyph, { borderColor: tone }]}>
      <View style={[styles.docGlyphLine, { backgroundColor: tone }]} />
      <View style={[styles.docGlyphLine, { backgroundColor: tone }]} />
    </View>
  );
}

export function DocumentRow({ doc, onError }: { doc: DocumentUploadOut; onError: (message: string) => void }) {
  const [opening, setOpening] = useState(false);
  const passed = doc.validation_status === 'pass';

  async function handleView() {
    setOpening(true);
    try {
      await openAdminDocumentFile(doc.id);
    } catch (e: any) {
      onError(e?.message ?? 'Could not open that file.');
    } finally {
      setOpening(false);
    }
  }

  return (
    <View style={[styles.docRow, !passed && styles.docRowFlagged]}>
      <DocGlyph tone={passed ? color.primary : color.danger} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.docType}>{DOC_TYPE_LABELS[doc.doc_type] ?? doc.doc_type}</Text>
        <Text style={styles.docMeta}>Uploaded {formatDate(doc.uploaded_at)}</Text>
        {!passed && !!doc.validation_notes && <Text style={styles.docNotes}>{doc.validation_notes}</Text>}
        {doc.ai_check !== 'expected' && (
          <Text style={[styles.docNotes, { color: doc.ai_check === 'other_document' ? color.warning : color.inkMuted }]}>
            {doc.ai_check === 'other_document' ? 'AI check: may be a different document' : 'AI check: not auto-checked'}
            {doc.ai_check_note ? ` — ${doc.ai_check_note}` : ''}
          </Text>
        )}
      </View>
      <View style={styles.docRight}>
        <Pill label={passed ? 'Passed' : 'Flagged'} tone={passed ? 'primary' : 'danger'} />
        {doc.ai_check === 'expected' && <Pill label="AI: looks right" tone="neutral" />}
        <Pressable onPress={handleView} disabled={opening} hitSlop={6} style={styles.viewButton}>
          {opening ? (
            <ActivityIndicator size="small" color={color.primary} />
          ) : (
            <Text style={styles.viewButtonLabel}>View file</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

export function DocumentList({ docs, onError }: { docs: DocumentUploadOut[]; onError: (message: string) => void }) {
  const flagged = docs.filter((d) => d.validation_status !== 'pass').length;
  return (
    <View style={styles.block}>
      <View style={styles.blockHeader}>
        <Text style={styles.blockLabel}>Documents · {docs.length}</Text>
        {flagged > 0 ? (
          <Text style={styles.blockHintDanger}>{flagged} flagged</Text>
        ) : docs.length > 0 ? (
          <Text style={styles.blockHint}>All passed checks</Text>
        ) : null}
      </View>
      {docs.length === 0 ? (
        <Text style={styles.blockHint}>No documents uploaded.</Text>
      ) : (
        <View style={{ gap: space.sm }}>
          {docs.map((doc) => (
            <DocumentRow key={doc.id} doc={doc} onError={onError} />
          ))}
        </View>
      )}
    </View>
  );
}

export function ReviewPanel({
  notes,
  onChangeNotes,
  busy,
  onApprove,
  onReject,
}: {
  notes: string;
  onChangeNotes: (v: string) => void;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= breakpoint.desktop;
  return (
    <View style={styles.block}>
      <Text style={styles.blockLabel}>Decision</Text>
      <TextInput
        style={styles.notesInput}
        value={notes}
        onChangeText={onChangeNotes}
        placeholder="Notes for the business (optional) — shown with a rejection"
        placeholderTextColor={color.inkFaint}
        multiline
      />
      <View style={[styles.actionsRow, isDesktop && styles.actionsRowDesktop]}>
        <Pressable
          style={({ pressed }) => [
            styles.actionButton,
            styles.rejectButton,
            isDesktop && styles.actionButtonDesktop,
            pressed && styles.rejectButtonPressed,
            busy && styles.disabled,
          ]}
          disabled={busy}
          onPress={onReject}
        >
          <Text style={styles.rejectLabel}>Reject</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.actionButton,
            styles.approveButton,
            isDesktop && styles.actionButtonDesktop,
            pressed && styles.approveButtonPressed,
            busy && styles.disabled,
          ]}
          disabled={busy}
          onPress={onApprove}
        >
          {busy ? <ActivityIndicator color={color.onPrimary} /> : <Text style={styles.approveLabel}>Approve</Text>}
        </Pressable>
      </View>
    </View>
  );
}

/* ─── Styles ────────────────────────────────────────── */

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: color.canvas },
  main: { flex: 1 },
  screen: { flex: 1, backgroundColor: color.canvas },
  content: {
    width: '100%',
    maxWidth: layout.maxWidthWide,
    alignSelf: 'center',
    paddingHorizontal: space.section,
    paddingTop: space.section,
    paddingBottom: space.section * 2,
  },
  contentPhone: { paddingHorizontal: layout.screenPadding, paddingTop: space.xl, paddingBottom: space.section },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.canvas },

  pageHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: space.lg,
    marginBottom: space.xxl,
  },
  pageHeaderText: { flex: 1, minWidth: 0 },
  eyebrow: {
    fontFamily: font.monoMedium,
    fontSize: fontSize.micro,
    lineHeight: lineHeight.micro,
    color: color.primary,
    letterSpacing: letterSpacing.label,
    textTransform: 'uppercase',
    marginBottom: space.xs,
  },
  title: {
    fontFamily: font.display,
    fontSize: fontSize.display,
    lineHeight: lineHeight.display,
    letterSpacing: letterSpacing.tight,
    color: color.ink,
  },
  titlePhone: { fontSize: fontSize.xl, lineHeight: lineHeight.xl },
  subtitle: { fontFamily: font.body, fontSize: fontSize.base, lineHeight: lineHeight.base, color: color.inkMuted, marginTop: space.xs },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  pillPrimary: { backgroundColor: color.primaryFaint },
  pillDanger: { backgroundColor: color.dangerFaint, borderWidth: 1, borderColor: color.dangerBorder },
  pillNeutral: { backgroundColor: color.surfaceSunken },
  pillSolid: { backgroundColor: color.primary },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillLabel: {
    fontFamily: font.monoMedium,
    fontSize: fontSize.micro,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  ghostButton: {
    minHeight: 36,
    minWidth: 88,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface,
  },
  ghostButtonPressed: { backgroundColor: color.surfaceSunken },
  ghostButtonLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.ink },
  disabled: { opacity: 0.5 },

  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: color.dangerFaint,
    borderWidth: 1,
    borderColor: color.dangerBorder,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    marginBottom: space.lg,
  },
  errorDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.danger },
  errorText: { flex: 1, fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.danger },

  sectionHeader: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md, marginTop: space.xl, marginBottom: space.md },
  sectionTitle: { fontFamily: font.display, fontSize: fontSize.lg, lineHeight: lineHeight.lg, color: color.ink },
  sectionCaption: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted, marginTop: 2 },

  emptyState: {
    alignItems: 'center',
    paddingVertical: space.section,
    paddingHorizontal: space.xl,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.border,
    borderRadius: radius.lg,
    gap: space.xs,
  },
  emptyRing: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: color.primaryFaint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  emptyRingInner: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: color.primary },
  emptyTitle: { fontFamily: font.bodySemi, fontSize: fontSize.base, color: color.ink, textAlign: 'center' },
  emptyBody: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted, textAlign: 'center', maxWidth: 360 },
  loadingBlock: { paddingVertical: space.section, alignItems: 'center' },

  card: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.xl,
    padding: space.xl,
    marginBottom: space.md,
    gap: space.lg,
  },
  cardHighlight: { borderColor: color.primaryBorder },

  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    minHeight: 44,
    marginBottom: space.md,
  },
  searchGlyph: { width: 14, height: 14 },
  searchGlyphRing: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, borderColor: color.inkFaint },
  searchGlyphHandle: {
    position: 'absolute',
    right: 0,
    bottom: 1,
    width: 5,
    height: 1.5,
    backgroundColor: color.inkFaint,
    transform: [{ rotate: '45deg' }],
  },
  searchInput: { flex: 1, fontFamily: font.body, fontSize: fontSize.base, color: color.ink, paddingVertical: space.sm },
  searchClear: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.primary },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.pill,
    paddingLeft: space.md,
    paddingRight: space.sm,
    paddingVertical: space.xs,
    minHeight: 32,
    backgroundColor: color.surface,
  },
  chipActive: { borderColor: color.primary, backgroundColor: color.primary },
  chipLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.inkMuted },
  chipLabelActive: { color: color.onPrimary },
  chipCount: { minWidth: 20, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 1, backgroundColor: color.surfaceSunken, alignItems: 'center' },
  chipCountActive: { backgroundColor: color.primaryPressed },
  chipCountLabel: { fontFamily: font.monoMedium, fontSize: fontSize.micro, color: color.inkMuted },
  chipCountLabelActive: { color: color.onPrimary },

  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: space.md,
    columnGap: space.xl,
    backgroundColor: color.surfaceSunken,
    borderRadius: radius.lg,
    padding: space.lg,
  },
  infoItem: { flexGrow: 1, flexBasis: 150, minWidth: 130 },
  infoLabel: {
    fontFamily: font.mono,
    fontSize: fontSize.micro,
    lineHeight: lineHeight.micro,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: color.inkFaint,
    marginBottom: 2,
  },
  infoValue: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.ink },

  block: { gap: space.sm },
  blockHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  blockLabel: {
    fontFamily: font.monoMedium,
    fontSize: fontSize.micro,
    letterSpacing: letterSpacing.label,
    textTransform: 'uppercase',
    color: color.inkMuted,
  },
  blockHint: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkFaint },
  blockHintDanger: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.danger },

  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderWidth: 1,
    borderColor: color.borderFaint,
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  docRowFlagged: { borderColor: color.dangerBorder, backgroundColor: color.dangerFaint },
  docGlyph: { width: 22, height: 28, borderWidth: 1.5, borderRadius: 3, paddingHorizontal: 4, paddingTop: 7, gap: 3 },
  docGlyphLine: { height: 1.5, borderRadius: 1 },
  docType: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.ink },
  docMeta: { fontFamily: font.body, fontSize: fontSize.micro, color: color.inkFaint, marginTop: 1 },
  docNotes: { marginTop: space.xs, fontFamily: font.body, fontSize: fontSize.sm, color: color.danger },
  docRight: { alignItems: 'flex-end', gap: space.sm },
  viewButton: { minHeight: 24, justifyContent: 'center' },
  viewButtonLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.primary },

  notesInput: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontFamily: font.body,
    fontSize: fontSize.sm,
    color: color.ink,
    backgroundColor: color.canvas,
    minHeight: 64,
    textAlignVertical: 'top',
  },
  actionsRow: { flexDirection: 'row', gap: space.md, marginTop: space.xs },
  actionsRowDesktop: { justifyContent: 'flex-end' },
  actionButton: {
    flex: 1,
    minHeight: layout.minTouchTarget,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  actionButtonDesktop: { flex: 0, minWidth: 132 },
  approveButton: { backgroundColor: color.primary },
  approveButtonPressed: { backgroundColor: color.primaryPressed },
  approveLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.onPrimary },
  rejectButton: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.dangerBorder },
  rejectButtonPressed: { backgroundColor: color.dangerFaint },
  rejectLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.danger },
});
