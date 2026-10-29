// app/admin-documents.tsx
// Admin Documents: supporting files for the study (interview data, thesis
// chapters, the survey, others), the project notes, and the platform's data
// sets — backend admin_library_service, admin-only.
// - Files: upload (title + category + file); .xlsx/.csv open here as a table
//   with sheet tabs and search, .pdf/images open in a new tab.
// - Notes: SYSTEM_PROCESS.md and CONNECT_NOTES.md as readable text (a fixed
//   whitelist on the server).
// - Data sets: categories → items → specs, NCR addresses (searchable), market
//   rules, withdrawal reasons, document types, profile visibility levels.
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { color, font, fontSize, lineHeight, letterSpacing, space, radius } from '../components/ui/tokens';
import {
  AdminShell, AdminCard, EmptyState, ErrorBanner, FilterChips, GhostButton, LoadingBlock, Pill, SearchField,
  SectionHeader, formatDate, useAdminAccess,
} from '../components/ui/AdminKit';
import {
  deleteAdminDocument, getAdminDatasets, getAdminDocumentTable, getAdminNote, listAdminDocuments, listAdminNotes,
  openAdminDocument, uploadAdminDocument,
  type AdminDatasetsOut, type AdminDocumentCategory, type AdminDocumentOut, type AdminDocumentTable,
} from '../lib/api/admin';
import { errorMessage } from '../lib/api/client';
import { isWebFilePickerSupported, pickWebFile } from '../lib/pickWebFile';

type Tab = 'files' | 'notes' | 'data';

const CATEGORIES: { value: AdminDocumentCategory; label: string }[] = [
  { value: 'interview_data', label: 'Interview data' },
  { value: 'thesis', label: 'Thesis chapter' },
  { value: 'survey', label: 'Survey' },
  { value: 'other', label: 'Other' },
];
const ACCEPT = '.xlsx,.csv,.pdf,.png,.jpg,.jpeg,.docx';
const MAX_SHOWN_ROWS = 500;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/* ─── Files ─────────────────────────────────────────── */

function UploadCard({ onUploaded, onError }: { onUploaded: () => void; onError: (m: string | null) => void }) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<AdminDocumentCategory>('interview_data');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = !busy && !!file && title.trim().length >= 2;

  async function choose() {
    if (!isWebFilePickerSupported()) return;
    const picked = await pickWebFile(ACCEPT);
    if (!picked) return;
    setFile(picked);
    if (!title.trim()) setTitle(picked.name.replace(/\.[^.]+$/, ''));
  }

  async function upload() {
    if (!ready || !file) return;
    setBusy(true);
    onError(null);
    try {
      await uploadAdminDocument(title.trim(), category, file, file.name);
      setTitle('');
      setFile(null);
      onUploaded();
    } catch (e: any) {
      onError(errorMessage(e, 'Could not upload that file.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminCard>
      <Text style={styles.cardTitle}>Upload a document</Text>
      <Text style={styles.muted}>.xlsx, .csv, .pdf, .png, .jpg or .docx, up to 25 MB. Stored encrypted; only administrators can open it.</Text>
      <FilterChips options={CATEGORIES} value={category} onChange={setCategory} />
      <TextInput value={title} onChangeText={setTitle} placeholder="Title, e.g. Interview data — buyers (n=12)"
        placeholderTextColor={color.inkFaint} maxLength={200} style={styles.input} />
      <View style={styles.row}>
        <Pressable onPress={choose} style={styles.secondary} accessibilityRole="button">
          <Text style={styles.secondaryLabel}>{file ? 'Choose another file' : 'Choose file'}</Text>
        </Pressable>
        {file && <Text style={styles.muted} numberOfLines={1}>{file.name} · {formatSize(file.size)}</Text>}
        <View style={{ flex: 1 }} />
        <Pressable onPress={upload} disabled={!ready} style={[styles.primary, !ready ? { opacity: 0.4 } : null]} accessibilityRole="button">
          <Text style={styles.primaryLabel}>{busy ? 'Uploading…' : 'Upload'}</Text>
        </Pressable>
      </View>
    </AdminCard>
  );
}

function TableView({ table, onClose }: { table: AdminDocumentTable; onClose: () => void }) {
  const [sheetName, setSheetName] = useState(table.sheets[0]?.name ?? '');
  const [query, setQuery] = useState('');
  const sheet = table.sheets.find((s) => s.name === sheetName) ?? table.sheets[0];
  const [header, ...body] = sheet?.rows ?? [];
  const q = query.trim().toLowerCase();
  const matches = q ? body.filter((r) => r.some((c) => c.toLowerCase().includes(q))) : body;
  const width = Math.max(header?.length ?? 0, ...body.map((r) => r.length));
  const cols = Array.from({ length: width }, (_, i) => i);

  return (
    <AdminCard highlight>
      <View style={styles.row}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.cardTitle}>{table.title}</Text>
          <Text style={styles.muted}>{table.filename}</Text>
        </View>
        <GhostButton label="Close" onPress={onClose} />
      </View>
      {table.sheets.length > 1 && (
        <FilterChips options={table.sheets.map((s) => ({ value: s.name, label: s.name, count: Math.max(0, s.total_rows - 1) }))}
          value={sheet?.name ?? ''} onChange={setSheetName} />
      )}
      <SearchField value={query} onChangeText={setQuery} placeholder="Search this sheet" />
      <Text style={styles.muted}>
        {matches.length} row{matches.length === 1 ? '' : 's'}{q ? ` matching "${query.trim()}"` : ''}
        {matches.length > MAX_SHOWN_ROWS ? ` — showing the first ${MAX_SHOWN_ROWS}` : ''}
        {sheet?.truncated ? ' · this sheet is longer than shown here; download it for every row' : ''}
      </Text>
      {!sheet || sheet.rows.length === 0 ? (
        <Text style={styles.muted}>This sheet is empty.</Text>
      ) : (
        <ScrollView horizontal style={styles.tableScroll}>
          <View>
            <View style={[styles.tr, styles.thRow]}>
              {cols.map((i) => <Text key={i} style={[styles.td, styles.th]} numberOfLines={2}>{header?.[i] ?? ''}</Text>)}
            </View>
            {matches.slice(0, MAX_SHOWN_ROWS).map((r, ri) => (
              <View key={ri} style={[styles.tr, ri % 2 === 1 ? styles.trAlt : null]}>
                {cols.map((i) => <Text key={i} style={styles.td} numberOfLines={3}>{r[i] ?? ''}</Text>)}
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </AdminCard>
  );
}

function FilesTab({ onError }: { onError: (m: string | null) => void }) {
  const [docs, setDocs] = useState<AdminDocumentOut[] | null>(null);
  const [table, setTable] = useState<AdminDocumentTable | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);

  const load = useCallback(() => {
    listAdminDocuments().then(setDocs).catch((e) => onError(errorMessage(e, 'Could not load the documents.')));
  }, [onError]);
  useEffect(load, [load]);

  async function open(d: AdminDocumentOut) {
    setBusyId(d.id);
    onError(null);
    try {
      if (d.opens_as_table) setTable(await getAdminDocumentTable(d.id));
      else await openAdminDocument(d.id);
    } catch (e: any) {
      onError(errorMessage(e, 'Could not open that file.'));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: number) {
    setBusyId(id);
    try {
      await deleteAdminDocument(id);
      if (table?.id === id) setTable(null);
      setConfirmId(null);
      load();
    } catch (e: any) {
      onError(errorMessage(e, 'Could not delete that file.'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <UploadCard onUploaded={load} onError={onError} />
      {table && <TableView table={table} onClose={() => setTable(null)} />}
      {docs === null ? (
        <LoadingBlock />
      ) : docs.length === 0 ? (
        <EmptyState title="No documents yet" body="Upload the interview data, thesis chapters or survey above." />
      ) : (
        <AdminCard>
          {docs.map((d, i) => (
            <View key={d.id} style={[styles.docRow, i > 0 ? styles.docRowDivider : null]}>
              <View style={{ flex: 1, minWidth: 200 }}>
                <Text style={styles.docTitle}>{d.title}</Text>
                <Text style={styles.muted}>{d.filename} · {formatSize(d.size_bytes)} · {d.uploaded_by}, {formatDate(d.created_at)}</Text>
              </View>
              <Pill label={d.category_label} />
              <Pressable onPress={() => open(d)} disabled={busyId === d.id} hitSlop={6}>
                <Text style={styles.link}>{busyId === d.id ? 'Opening…' : d.opens_as_table ? 'Open table' : 'Open'}</Text>
              </Pressable>
              {confirmId === d.id ? (
                <View style={styles.row}>
                  <Pressable onPress={() => remove(d.id)} hitSlop={6}><Text style={styles.dangerLink}>Delete for good</Text></Pressable>
                  <Pressable onPress={() => setConfirmId(null)} hitSlop={6}><Text style={styles.link}>Keep</Text></Pressable>
                </View>
              ) : (
                <Pressable onPress={() => setConfirmId(d.id)} hitSlop={6}><Text style={styles.dangerLink}>Delete</Text></Pressable>
              )}
            </View>
          ))}
        </AdminCard>
      )}
    </>
  );
}

/* ─── Notes (Markdown as readable text) ─────────────── */

/** **bold** and `code` inside one line. */
function Inline({ text, style }: { text: string; style: any }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return (
    <Text style={style}>
      {parts.map((p, i) =>
        p.startsWith('**') ? <Text key={i} style={{ fontFamily: font.bodySemi }}>{p.slice(2, -2)}</Text>
          : p.startsWith('`') ? <Text key={i} style={styles.inlineCode}>{p.slice(1, -1)}</Text>
            : p)}
    </Text>
  );
}

function Markdown({ source }: { source: string }) {
  const blocks: ReactElement[] = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i]);
      blocks.push(<Text key={i} style={styles.codeBlock}>{code.join('\n')}</Text>);
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      blocks.push(<Inline key={i} text={heading[2]} style={level === 1 ? styles.h1 : level === 2 ? styles.h2 : styles.h3} />);
      continue;
    }
    const bullet = /^(\s*)[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      const depth = Math.min(3, Math.floor(bullet[1].length / 2));
      blocks.push(
        <View key={i} style={[styles.bullet, { paddingLeft: depth * space.lg }]}>
          <Text style={styles.bulletDot}>•</Text>
          <Inline text={bullet[2]} style={[styles.body, { flex: 1 }]} />
        </View>,
      );
      continue;
    }
    if (/^---+\s*$/.test(line)) {
      blocks.push(<View key={i} style={styles.rule} />);
      continue;
    }
    if (line.trim()) blocks.push(<Inline key={i} text={line} style={styles.body} />);
  }
  return <View style={{ gap: space.xs }}>{blocks}</View>;
}

function NotesTab({ onError }: { onError: (m: string | null) => void }) {
  const [names, setNames] = useState<string[]>([]);
  const [name, setName] = useState<string>('');
  const [content, setContent] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    listAdminNotes().then((n) => { setNames(n); setName(n[0] ?? ''); }).catch((e) => onError(errorMessage(e, 'Could not load the notes.')));
  }, [onError]);
  useEffect(() => {
    if (!name) return;
    setContent(null);
    getAdminNote(name).then((n) => setContent(n.content)).catch((e) => onError(errorMessage(e, 'Could not open that note.')));
  }, [name, onError]);

  // Search keeps whole sections (from one heading to the next) that mention the words.
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!content || !q) return content;
    const sections = content.split(/\n(?=#{1,4}\s)/);
    return sections.filter((s) => s.toLowerCase().includes(q)).join('\n') || '';
  }, [content, query]);

  if (names.length === 0) return <LoadingBlock />;
  return (
    <>
      <FilterChips options={names.map((n) => ({ value: n, label: n }))} value={name} onChange={setName} />
      <SearchField value={query} onChangeText={setQuery} placeholder="Search this note" />
      <AdminCard>
        {shown === null ? <LoadingBlock /> : shown ? <Markdown source={shown} /> : <Text style={styles.muted}>Nothing matches.</Text>}
      </AdminCard>
    </>
  );
}

/* ─── Data sets ─────────────────────────────────────── */

type DataView = 'categories' | 'addresses' | 'rules' | 'withdrawals' | 'documents' | 'privacy';

function DataTab({ onError }: { onError: (m: string | null) => void }) {
  const [data, setData] = useState<AdminDatasetsOut | null>(null);
  const [view, setView] = useState<DataView>('categories');
  const [query, setQuery] = useState('');

  useEffect(() => {
    getAdminDatasets().then(setData).catch((e) => onError(errorMessage(e, 'Could not load the data sets.')));
  }, [onError]);
  if (!data) return <LoadingBlock />;

  const q = query.trim().toLowerCase();
  const barangayCount = data.ncr_addresses.reduce((n, c) => n + c.barangays.length, 0);

  return (
    <>
      <FilterChips<DataView>
        options={[
          { value: 'categories', label: 'Categories & specs', count: data.categories.reduce((n, c) => n + c.items.length, 0) },
          { value: 'addresses', label: 'NCR addresses', count: barangayCount },
          { value: 'rules', label: 'Market rules' },
          { value: 'withdrawals', label: 'Withdrawal reasons', count: data.withdrawal_reasons.length },
          { value: 'documents', label: 'Document types', count: data.document_types.length },
          { value: 'privacy', label: 'Profile visibility' },
        ]}
        value={view}
        onChange={(v) => { setView(v); setQuery(''); }}
      />

      {view === 'categories' && data.categories.map((c) => (
        <AdminCard key={c.name}>
          <Text style={styles.cardTitle}>{c.name}</Text>
          {c.items.map((it) => (
            <View key={it.code} style={styles.dataBlock}>
              <Text style={styles.docTitle}>{it.name} <Text style={styles.mono}>· {it.code}</Text></Text>
              {it.specs.map((s) => (
                <Text key={s.id} style={styles.muted}>
                  <Text style={{ color: color.ink }}>{s.label}</Text>
                  {s.unit ? ` (${s.unit})` : ''} · {s.required ? 'required' : 'optional'} · {s.type}
                  {s.options.length ? ` — ${s.options.join(', ')}` : ''}
                </Text>
              ))}
            </View>
          ))}
        </AdminCard>
      ))}

      {view === 'addresses' && (
        <>
          <SearchField value={query} onChangeText={setQuery} placeholder="Search a city, barangay or ZIP code" />
          <Text style={styles.muted}>{data.ncr_addresses.length} cities · {barangayCount} barangays (PSA PSGC). ZIP codes are not PHLPost's official list.</Text>
          {data.ncr_addresses.map((c) => {
            const cityHit = !q || c.city.toLowerCase().includes(q);
            const brgys = cityHit ? c.barangays : c.barangays.filter((b) => b.name.toLowerCase().includes(q) || (b.zip ?? '').includes(q));
            const zips = cityHit ? c.zips : c.zips.filter((z) => z.zip.includes(q) || z.area.toLowerCase().includes(q));
            if (!cityHit && brgys.length === 0 && zips.length === 0) return null;
            return (
              <AdminCard key={c.city}>
                <Text style={styles.cardTitle}>{c.city} <Text style={styles.muted}>· {c.barangays.length} barangays</Text></Text>
                {zips.length > 0 && <Text style={styles.muted}>ZIP: {zips.map((z) => `${z.zip} ${z.area}`).join(' · ')}</Text>}
                <Text style={styles.body}>{brgys.map((b) => (b.zip ? `${b.name} (${b.zip})` : b.name)).join(', ')}</Text>
              </AdminCard>
            );
          })}
        </>
      )}

      {view === 'rules' && (
        <AdminCard>
          {data.market_rules.map((r) => (
            <View key={r.label} style={styles.kv}><Text style={styles.body}>{r.label}</Text><Text style={styles.kvValue}>{r.value}</Text></View>
          ))}
        </AdminCard>
      )}

      {view === 'withdrawals' && (
        <AdminCard>
          <Text style={styles.blockLabel}>Reasons a supplier picks</Text>
          {data.withdrawal_reasons.map((r) => (
            <View key={r.code} style={styles.kv}><Text style={styles.body}>{r.label}</Text><Text style={styles.mono}>{r.code}</Text></View>
          ))}
          <Text style={[styles.blockLabel, { marginTop: space.md }]}>Within the window</Text>
          {data.withdrawal_consequences.map((c) => (
            <Text key={c.count} style={styles.body}><Text style={{ fontFamily: font.bodySemi }}>{c.count}{c.count === 3 ? '+' : ''} · {c.stage}:</Text> {c.text}</Text>
          ))}
        </AdminCard>
      )}

      {view === 'documents' && (
        <AdminCard>
          {data.document_types.map((d) => (
            <View key={d.code} style={styles.kv}><Text style={styles.body}>{d.label}</Text><Text style={styles.mono}>{d.code}</Text></View>
          ))}
        </AdminCard>
      )}

      {view === 'privacy' && (
        <AdminCard>
          <Text style={styles.blockLabel}>Levels</Text>
          <Text style={styles.body}>{data.profile_visibility.levels.join(' · ')}</Text>
          <Text style={[styles.blockLabel, { marginTop: space.md }]}>Sections the owner sets</Text>
          <Text style={styles.body}>{data.profile_visibility.sections.join(' · ')}</Text>
        </AdminCard>
      )}
    </>
  );
}

export default function AdminDocumentsRoute() {
  const access = useAdminAccess();
  const [tab, setTab] = useState<Tab>('files');
  const [error, setError] = useState<string | null>(null);
  const reportError = useCallback((m: string | null) => setError(m), []);

  return (
    <AdminShell access={access} title="Documents & API" subtitle="Study files, project notes and the platform's data sets — administrators only">
      {error && <ErrorBanner message={error} />}
      <FilterChips<Tab>
        options={[{ value: 'files', label: 'Files' }, { value: 'notes', label: 'Notes' }, { value: 'data', label: 'Data sets' }]}
        value={tab}
        onChange={(t) => { setTab(t); setError(null); }}
      />
      <SectionHeader
        title={tab === 'files' ? 'Files' : tab === 'notes' ? 'Project notes' : 'Data sets'}
        caption={tab === 'files' ? 'Spreadsheets open here as a table; PDFs and images open in a new tab'
          : tab === 'notes' ? 'Read-only copies of the notes in the project folder'
            : 'What the platform uses for categories, addresses and rules'}
      />
      {access === 'GRANTED' && (tab === 'files' ? <FilesTab onError={reportError} /> : tab === 'notes' ? <NotesTab onError={reportError} /> : <DataTab onError={reportError} />)}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  cardTitle: { fontFamily: font.bodySemi, fontSize: fontSize.md, lineHeight: lineHeight.md, color: color.ink },
  docTitle: { fontFamily: font.bodySemi, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.ink },
  body: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.ink },
  muted: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  mono: { fontFamily: font.mono, fontSize: fontSize.sm, color: color.inkMuted },
  blockLabel: { fontFamily: font.monoMedium, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.inkFaint },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md },
  input: { borderWidth: 1, borderColor: color.border, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, fontFamily: font.body, fontSize: fontSize.sm, color: color.ink, backgroundColor: color.canvas },
  primary: { backgroundColor: color.primary, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  primaryLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.onPrimary },
  secondary: { borderWidth: 1, borderColor: color.border, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.sm, backgroundColor: color.surface },
  secondaryLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.ink },
  link: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.primary },
  dangerLink: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.danger },
  docRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  docRowDivider: { borderTopWidth: 1, borderTopColor: color.borderFaint },
  tableScroll: { borderWidth: 1, borderColor: color.border, borderRadius: radius.md },
  tr: { flexDirection: 'row' },
  thRow: { backgroundColor: color.surfaceSunken, borderBottomWidth: 1, borderBottomColor: color.border },
  trAlt: { backgroundColor: color.canvas },
  td: { width: 170, paddingHorizontal: space.sm, paddingVertical: space.xs, fontFamily: font.body, fontSize: fontSize.sm, color: color.ink, borderRightWidth: 1, borderRightColor: color.borderFaint },
  th: { fontFamily: font.bodySemi },
  h1: { fontFamily: font.display, fontSize: fontSize.xl, lineHeight: lineHeight.xl, color: color.ink, marginTop: space.lg },
  h2: { fontFamily: font.display, fontSize: fontSize.lg, lineHeight: lineHeight.lg, color: color.ink, marginTop: space.md },
  h3: { fontFamily: font.bodySemi, fontSize: fontSize.md, lineHeight: lineHeight.md, color: color.ink, marginTop: space.sm },
  bullet: { flexDirection: 'row', gap: space.sm },
  bulletDot: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  inlineCode: { fontFamily: font.mono, fontSize: fontSize.sm, color: color.primary },
  codeBlock: { fontFamily: font.mono, fontSize: fontSize.sm, color: color.ink, backgroundColor: color.surfaceSunken, borderRadius: radius.md, padding: space.md },
  rule: { height: 1, backgroundColor: color.border, marginVertical: space.md },
  dataBlock: { gap: 2, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: color.borderFaint },
  kv: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: space.md, paddingVertical: space.xs, borderTopWidth: 1, borderTopColor: color.borderFaint },
  kvValue: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.ink },
});
