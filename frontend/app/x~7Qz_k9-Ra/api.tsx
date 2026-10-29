// app/x~7Qz_k9-Ra/api.tsx
// Admin API reference: every backend endpoint, read from the live
// /openapi.json and grouped by tag (auth, requirements, business,
// notifications, messages, meta). Each row shows the method, path, summary
// and who can call it ("x-access", added by the backend from the route's auth
// dependency); expanding it lists the parameters and the request and response
// fields. A search box filters by path, summary or tag; /docs is linked for
// trying calls out.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { color, font, fontSize, lineHeight, letterSpacing, space, radius } from '../../components/ui/tokens';
import { AdminShell, AdminCard, EmptyState, ErrorBanner, FilterChips, GhostButton, LoadingBlock, Pill, SearchField, useAdminAccess } from '../../components/ui/AdminKit';
import { getOpenApi } from '../../lib/api/admin';
import { API_BASE_URL, errorMessage } from '../../lib/api/client';

const TAG_ORDER = ['auth', 'requirements', 'business', 'notifications', 'messages', 'meta'];
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

interface Field {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

interface Endpoint {
  key: string;
  method: string;
  path: string;
  tag: string;
  summary: string;
  description: string;
  access: string;
  params: Field[];
  body: Field[];
  bodyKind: string | null; // JSON | Form | null
  response: Field[];
  responseType: string | null;
}

type Schema = Record<string, any>;

function refName(ref: string): string {
  return ref.split('/').pop() ?? ref;
}

/** A readable type for one schema: "string", "integer | null", "list of RequirementOut", … */
function typeOf(schema: Schema | undefined, spec: Schema): string {
  if (!schema) return 'any';
  if (schema.$ref) return refName(schema.$ref);
  if (schema.anyOf || schema.oneOf) {
    const parts = (schema.anyOf ?? schema.oneOf).map((s: Schema) => (s.type === 'null' ? 'null' : typeOf(s, spec)));
    return Array.from(new Set(parts)).join(' | ');
  }
  if (schema.allOf?.length === 1) return typeOf(schema.allOf[0], spec);
  if (schema.type === 'array') return `list of ${typeOf(schema.items, spec)}`;
  if (schema.enum) return schema.enum.map(String).join(' | ');
  if (schema.type === 'string' && schema.format) return `string (${schema.format})`;
  if (schema.type === 'object' && schema.additionalProperties) return `map of ${typeOf(schema.additionalProperties, spec)}`;
  return schema.type ?? 'object';
}

function resolve(schema: Schema | undefined, spec: Schema): Schema | undefined {
  if (!schema) return undefined;
  if (schema.$ref) return spec.components?.schemas?.[refName(schema.$ref)];
  if (schema.allOf?.length === 1) return resolve(schema.allOf[0], spec);
  return schema;
}

/** The top-level fields of an object schema (one level — nested objects show their type name). */
function fieldsOf(schema: Schema | undefined, spec: Schema): Field[] {
  let s = resolve(schema, spec);
  if (s?.type === 'array') s = resolve(s.items, spec);
  if (!s?.properties) return [];
  const required = new Set<string>(s.required ?? []);
  return Object.entries(s.properties as Record<string, Schema>).map(([name, prop]) => ({
    name,
    type: typeOf(prop, spec),
    required: required.has(name),
    description: prop.description,
  }));
}

function parseSpec(spec: Schema): Endpoint[] {
  const out: Endpoint[] = [];
  for (const [path, ops] of Object.entries(spec.paths ?? {}) as [string, Schema][]) {
    for (const method of METHODS) {
      const op = ops[method];
      if (!op) continue;
      const content = op.requestBody?.content ?? {};
      const bodyKind = content['application/json'] ? 'JSON' : content['multipart/form-data'] || content['application/x-www-form-urlencoded'] ? 'Form' : null;
      const bodySchema = (content['application/json'] ?? content['multipart/form-data'] ?? content['application/x-www-form-urlencoded'])?.schema;
      const ok = op.responses?.['200'] ?? op.responses?.['201'];
      const responseSchema = ok?.content?.['application/json']?.schema;
      out.push({
        key: `${method} ${path}`,
        method: method.toUpperCase(),
        path,
        tag: op.tags?.[0] ?? 'other',
        summary: op.summary ?? '',
        description: op.description ?? '',
        access: op['x-access'] ?? 'Public',
        params: (op.parameters ?? []).map((p: Schema) => ({
          name: `${p.name} (${p.in})`,
          type: typeOf(p.schema, spec),
          required: !!p.required,
          description: p.description,
        })),
        body: fieldsOf(bodySchema, spec),
        bodyKind,
        response: fieldsOf(responseSchema, spec),
        responseType: op.responses?.['204'] ? 'No content (204)' : responseSchema ? typeOf(responseSchema, spec) : null,
      });
    }
  }
  return out;
}

function accessTone(access: string): 'primary' | 'danger' | 'neutral' | 'solid' {
  if (access === 'Admins only') return 'danger';
  if (access === 'Public') return 'neutral';
  return 'primary';
}

function FieldTable({ title, fields, note }: { title: string; fields: Field[]; note?: string | null }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text style={styles.blockLabel}>{title}{note ? ` · ${note}` : ''}</Text>
      {fields.length === 0 ? (
        <Text style={styles.muted}>{note ? 'No listed fields.' : 'None.'}</Text>
      ) : (
        fields.map((f) => (
          <View key={f.name} style={styles.fieldRow}>
            <Text style={styles.fieldName}>{f.name}{f.required ? '' : '?'}</Text>
            <Text style={styles.fieldType}>{f.type}</Text>
            {!!f.description && <Text style={[styles.muted, { flexBasis: '100%' }]}>{f.description}</Text>}
          </View>
        ))
      )}
    </View>
  );
}

function EndpointRow({ e, open, onToggle }: { e: Endpoint; open: boolean; onToggle: () => void }) {
  return (
    <View style={styles.endpoint}>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }} style={styles.endpointHead}>
        <View style={[styles.method, e.method === 'GET' ? styles.methodGet : e.method === 'DELETE' ? styles.methodDelete : styles.methodWrite]}>
          <Text style={[styles.methodLabel, e.method === 'GET' ? { color: color.primary } : e.method === 'DELETE' ? { color: color.danger } : { color: color.onPrimary }]}>{e.method}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 220 }}>
          <Text style={styles.path}>{e.path}</Text>
          {!!e.summary && <Text style={styles.muted}>{e.summary}</Text>}
        </View>
        <Pill label={e.access} tone={accessTone(e.access)} />
        <Text style={styles.toggle}>{open ? 'Hide' : 'Details'}</Text>
      </Pressable>
      {open && (
        <View style={styles.details}>
          {!!e.description && <Text style={styles.body}>{e.description.trim()}</Text>}
          <Text style={styles.muted}>Who can call it: {e.access}</Text>
          <FieldTable title="Parameters" fields={e.params} />
          {e.bodyKind && <FieldTable title="Request body" fields={e.body} note={e.bodyKind} />}
          <FieldTable title="Response" fields={e.response} note={e.responseType} />
        </View>
      )}
    </View>
  );
}

export default function AdminApiRoute() {
  const access = useAdminAccess();
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('all');
  const [openKey, setOpenKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEndpoints(parseSpec(await getOpenApi()));
    } catch (e: any) {
      setError(errorMessage(e, 'Could not load the API description.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (access === 'GRANTED') load();
  }, [access, load]);

  const tags = useMemo(() => {
    const present = Array.from(new Set(endpoints.map((e) => e.tag)));
    const rank = (t: string) => (TAG_ORDER.includes(t) ? TAG_ORDER.indexOf(t) : TAG_ORDER.length);
    return present.sort((a, b) => rank(a) - rank(b));
  }, [endpoints]);

  const q = query.trim().toLowerCase();
  const shown = endpoints.filter((e) =>
    (tag === 'all' || e.tag === tag)
    && (!q || [e.path, e.summary, e.method, e.access, e.tag].some((v) => v.toLowerCase().includes(q))));

  return (
    <AdminShell
      access={access}
      title="Documents & API"
      subtitle={`${endpoints.length} endpoints, read live from the backend's OpenAPI description`}
      actions={
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <GhostButton label="Open /docs" onPress={() => { if (typeof window !== 'undefined') window.open(`${API_BASE_URL}/docs`, '_blank'); }} />
          <GhostButton label="Refresh" onPress={load} busy={loading} />
        </View>
      }
    >
      {error && <ErrorBanner message={error} />}
      {loading && endpoints.length === 0 ? (
        <LoadingBlock />
      ) : (
        <>
          <SearchField value={query} onChangeText={setQuery} placeholder="Search by path, summary, method or who can call it" />
          <FilterChips
            options={[{ value: 'all', label: 'All', count: endpoints.length },
              ...tags.map((t) => ({ value: t, label: t, count: endpoints.filter((e) => e.tag === t).length }))]}
            value={tag}
            onChange={setTag}
          />
          {shown.length === 0 ? (
            <EmptyState title="No endpoints match" body="Try a different search or tag." />
          ) : (
            (tag === 'all' ? tags : [tag]).map((t) => {
              const rows = shown.filter((e) => e.tag === t);
              if (rows.length === 0) return null;
              return (
                <AdminCard key={t}>
                  <Text style={styles.tagTitle}>{t} <Text style={styles.muted}>· {rows.length}</Text></Text>
                  {rows.map((e) => (
                    <EndpointRow key={e.key} e={e} open={openKey === e.key} onToggle={() => setOpenKey(openKey === e.key ? null : e.key)} />
                  ))}
                </AdminCard>
              );
            })
          )}
        </>
      )}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  tagTitle: { fontFamily: font.display, fontSize: fontSize.lg, lineHeight: lineHeight.lg, color: color.ink, textTransform: 'capitalize' },
  endpoint: { borderTopWidth: 1, borderTopColor: color.borderFaint },
  endpointHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  method: { minWidth: 64, alignItems: 'center', borderRadius: radius.sm, borderWidth: 1, paddingVertical: 2, paddingHorizontal: space.sm },
  methodGet: { borderColor: color.primaryBorder, backgroundColor: color.primaryFaint },
  methodWrite: { borderColor: color.primary, backgroundColor: color.primary },
  methodDelete: { borderColor: color.dangerBorder, backgroundColor: color.dangerFaint },
  methodLabel: { fontFamily: font.monoMedium, fontSize: fontSize.micro, letterSpacing: letterSpacing.label },
  path: { fontFamily: font.monoMedium, fontSize: fontSize.sm, color: color.ink },
  toggle: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.primary },
  details: { gap: space.md, paddingBottom: space.lg, paddingLeft: space.md, borderLeftWidth: 2, borderLeftColor: color.primaryBorder, marginBottom: space.md },
  body: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.ink },
  muted: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  blockLabel: { fontFamily: font.monoMedium, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.inkFaint },
  fieldRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, paddingVertical: 2 },
  fieldName: { fontFamily: font.monoMedium, fontSize: fontSize.sm, color: color.ink, minWidth: 180 },
  fieldType: { fontFamily: font.mono, fontSize: fontSize.sm, color: color.inkMuted },
});
