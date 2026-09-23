// features/post-requirement/PostRequirement.tsx
// One component, four steps from PostRequirementState — DETAILS, DELIVERY, CLOSING, REVIEW.
// Each step is a self-contained screen owning its own local draft state (seeded from
// `initial`, reported upward on Continue), the same way Onboarding.tsx's IdentityScreen /
// OperationsScreen / DocumentsScreen each own their draft and call the shared
// `reportContinue` — the route (app/post-requirement.tsx) accumulates the three collected
// drafts step by step, exactly like Onboarding's route accumulates IdentityDraft /
// OperationsDraft / DocumentsDraft. Going back never clears a later step's saved draft, so
// re-entering a step always re-seeds from what was last entered.
//
// Shell (persistent header bar, fixed bottom bar, sliding StepTransition, reportContinue
// wiring the active screen's validated action to the bottom bar's primary button, the
// segmented step indicator) reuses the exact structure and style values from
// features/onboarding/Onboarding.tsx — same shellHeader/shellScroll/shellInner/bottomBar
// treatment, same StepTransition slide+cross-fade mechanic, same FormSection/FormDivider
// field-grouping idiom instead of nested cards. STEP_ORDER now carries all four
// PostRequirementState members; there is no separate local step type.
//
// REVIEW is a read-only summary (What you need / Where and when / Closing) plus a sealed-
// quotations explanation and the existing "Before you publish" lock list — not a mock of
// the respondent-facing page.
//
// Locking rule: what stops being editable on publish (scope and specifications, quantity,
// indicative budget, closing date and time) matches RequirementDetail.tsx's OWNER_SEALED
// EditabilityList verbatim — that component is the established ground truth for what locks.

import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet } from 'react-native';
import ScreenScroll from '../../components/ui/ScreenScroll';
import type { LayoutChangeEvent } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import {
  color,
  font,
  fontSize,
  lineHeight,
  letterSpacing,
  space,
  radius,
  elevation,
  layout,
} from '../../components/ui/tokens';
import type { Business, Attachment, ISODateTime, SpecRow, PostRequirementState } from '../../lib/types';
import { CATEGORIES } from './constants';
import { isRecognizedCity } from '../../lib/data/philippines';
import { isWebFilePickerSupported, pickWebFile } from '../../lib/pickWebFile';

/* ─── Draft shapes ───────────────────────────────────────
 * One draft per step, assembled into a real `Requirement` by the route only once REVIEW
 * publishes — the same shape Onboarding's IdentityDraft/OperationsDraft/DocumentsDraft are
 * assembled into a `Business` only once DOCUMENTS submits. */

export interface RequirementDetailsDraft {
  category: string;
  title: string;
  scope: string;
  specifications: SpecRow[];
  quantity: string;
  budgetMin: number | null;
  budgetMax: number | null;
  requiredDocuments: string[];
}

export interface RequirementDeliveryDraft {
  city: string;
  address: string;
  windowFrom: string; // "YYYY-MM-DD"
  windowTo: string;   // "YYYY-MM-DD"
  attachments: Attachment[];
}

export interface RequirementClosingDraft {
  closeDate: string; // "YYYY-MM-DD"
  closeTime: string; // one of TIME_OPTIONS' values
}

/** The three step drafts combined into what the route needs to assemble a `Requirement`. */
export interface RequirementDraftInput {
  category: string;
  title: string;
  scope: string;
  specifications: SpecRow[];
  quantity: string;
  budgetMin: number | null;
  budgetMax: number | null;
  requiredDocuments: string[];
  deliveryCity: string;
  deliveryAddress: string;
  deliveryWindowFrom: string;
  deliveryWindowTo: string;
  attachments: Attachment[];
  closingAt: ISODateTime;
}

interface DetailsProps {
  state: Extract<PostRequirementState, 'DETAILS'>;
  poster: Business;
  initial?: Partial<RequirementDetailsDraft>;
  onContinue: (draft: RequirementDetailsDraft) => void;
  /** Assistive category suggestion — reads title + scope, returns one of the
   *  fixed categories or null. Optional: the pill list below works exactly
   *  the same with or without it wired up. */
  onSuggestCategory?: (title: string, scope: string) => Promise<string | null>;
}

interface DeliveryProps {
  state: Extract<PostRequirementState, 'DELIVERY'>;
  poster: Business;
  details: RequirementDetailsDraft;
  initial?: Partial<RequirementDeliveryDraft>;
  onContinue: (draft: RequirementDeliveryDraft) => void;
  onBack: () => void;
}

interface ClosingProps {
  state: Extract<PostRequirementState, 'CLOSING'>;
  poster: Business;
  details: RequirementDetailsDraft;
  delivery: RequirementDeliveryDraft;
  initial?: Partial<RequirementClosingDraft>;
  onContinue: (draft: RequirementClosingDraft) => void;
  onBack: () => void;
}

interface ReviewProps {
  state: Extract<PostRequirementState, 'REVIEW'>;
  poster: Business;
  details: RequirementDetailsDraft;
  delivery: RequirementDeliveryDraft;
  closing: RequirementClosingDraft;
  onBack: () => void;
  onPublish: (draft: RequirementDraftInput) => void;
  /** Set by the route when the publish call itself fails (e.g. a 403 that slipped
   *  past the earlier verification gate) — surfaced here since REVIEW is the only
   *  screen still mounted when that response comes back. */
  publishError?: string | null;
}

export type PostRequirementProps = DetailsProps | DeliveryProps | ClosingProps | ReviewProps;

/* ─── Constants ─────────────────────────────────────────
 * Categories mirror the six onboarding offers — see mock.ts. Time and preset options are
 * screen-local UI sugar, not domain data, so they live here rather than in mock.ts. */

/** Mirrors RequirementCreate's Field(min_length=..., max_length=...) in
 *  backend/app/schemas/requirement.py exactly — a mismatch here means a
 *  requirement can clear every DETAILS-step check and still 422 at publish,
 *  the bug this file's fields used to have (scope only checked non-empty,
 *  backend required 10+ characters). */
const TITLE_MIN = 5;
const TITLE_MAX = 200;
const SCOPE_MIN = 10;
const SCOPE_MAX = 3000;
const QUANTITY_MAX = 200;
const SPEC_LABEL_MIN = 2;
const SPEC_LABEL_MAX = 100;
const SPEC_VALUE_MIN = 2;
const SPEC_VALUE_MAX = 200;
const SITE_ADDRESS_MAX = 300;

/** One example label/value pair per category, shown as the Specifications
 *  row's placeholder text once a category is picked — before that, a
 *  generic fabrication-flavored example (kept as the literal default so
 *  existing behavior is unchanged when nothing's selected yet). Purely
 *  illustrative: never prefilled into the actual fields, and picking a
 *  different category doesn't touch specs the buyer already typed. */
const SPEC_EXAMPLE_BY_CATEGORY: Record<string, { label: string; value: string }> = {
  'Printing': { label: 'e.g. Paper size and stock', value: 'e.g. A4, 80gsm bond paper' },
  'Construction Supply': { label: 'e.g. Material grade', value: 'e.g. Portland cement Type 1, 50kg bags' },
  'Fabrication & Manufacturing': { label: 'e.g. Platform area', value: 'e.g. 240 sqm (20.0 m × 12.0 m)' },
  'Industrial Services': { label: 'e.g. Service frequency', value: 'e.g. Quarterly preventive maintenance' },
  'Food Supply & Catering': { label: 'e.g. Menu style', value: 'e.g. Buffet, 3 main dishes + dessert' },
  'Medical & Clinic Supplies': { label: 'e.g. Product standard', value: 'e.g. Surgical grade, ISO 13485' },
  'IT Equipment & Hardware': { label: 'e.g. Spec requirement', value: 'e.g. Intel i5, 16GB RAM, 512GB SSD' },
  'Vehicle Parts & Services': { label: 'e.g. Part and model fit', value: 'e.g. Brake pads, Toyota Hilux 2020' },
  'Packaging & Labeling': { label: 'e.g. Box dimensions', value: 'e.g. 30 cm × 20 cm × 15 cm, corrugated' },
  'Office & Janitorial Supplies': { label: 'e.g. Item spec', value: 'e.g. A4 bond paper, 500 sheets/ream' },
};
const DEFAULT_SPEC_EXAMPLE = SPEC_EXAMPLE_BY_CATEGORY['Fabrication & Manufacturing'];

/** Typical qualifying documents per category — a starting suggestion for
 *  the (optional, per the study's own Scope and Delimitation) Required
 *  documents field, not a mandate. Only ever pre-fills the field while it's
 *  still empty (see the Category pill's onPress) — a buyer who has already
 *  added or removed anything here keeps full control, same convention as
 *  every other suggestion feature in this app. */
const REQUIRED_DOCS_BY_CATEGORY: Record<string, string[]> = {
  'Printing': ['DENR Permit'],
  'Construction Supply': ['BPS Product/Import Certificate (PS/ICC)'],
  'Fabrication & Manufacturing': ['DENR Permit'],
  'Industrial Services': ['DTI Accreditation', 'DOLE Registration', 'PCAB License'],
  'Food Supply & Catering': ['Sanitary Permit', 'Health Certificate', 'FDA License to Operate'],
  'Medical & Clinic Supplies': ['FDA License to Operate'],
  'IT Equipment & Hardware': ['NTC Permit', 'BPS Certification'],
  'Vehicle Parts & Services': ['DTI Service & Repair Accreditation'],
  'Packaging & Labeling': ['DENR Permit', 'FDA License to Operate'],
  'Office & Janitorial Supplies': ['DOLE Registration', 'FDA License to Operate'],
};

/** Same convention as SPEC_EXAMPLE_BY_CATEGORY, extended to Title, Scope,
 *  and Quantity — placeholder text only, never prefilled into the actual
 *  fields, and switching category never touches anything already typed. */
const DETAILS_EXAMPLE_BY_CATEGORY: Record<string, { title: string; scope: string; quantity: string }> = {
  'Printing': {
    title: 'e.g. Bulk printing of tarpaulins for a company event',
    scope: 'e.g. Full-color tarpaulin printing, weatherproof, with grommets every 50cm.',
    quantity: 'e.g. 20 pieces, 3ft × 8ft each',
  },
  'Construction Supply': {
    title: 'e.g. Supply of cement and rebar for a warehouse slab',
    scope: 'e.g. Ready-mix concrete and reinforcing steel delivered to site, per the attached plan.',
    quantity: 'e.g. 80 cu.m. concrete, 5 tons rebar',
  },
  'Fabrication & Manufacturing': {
    title: 'e.g. Fabrication and installation of steel mezzanine platform',
    scope: 'What is included and what is not — the boundaries of the work.',
    quantity: 'e.g. 1 platform',
  },
  'Industrial Services': {
    title: 'e.g. Quarterly preventive maintenance for production line equipment',
    scope: 'e.g. Scheduled inspection, lubrication, and part replacement for 5 machines.',
    quantity: 'e.g. 5 units',
  },
  'Food Supply & Catering': {
    title: 'e.g. Catering services for a company annual event',
    scope: 'e.g. Buffet-style catering including setup and service staff for 200 guests.',
    quantity: 'e.g. 200 pax',
  },
  'Medical & Clinic Supplies': {
    title: 'e.g. Supply of PPE and consumables for a clinic',
    scope: 'e.g. Monthly supply of gloves, masks, and surgical consumables per the attached list.',
    quantity: 'e.g. 50 boxes gloves, 100 boxes masks',
  },
  'IT Equipment & Hardware': {
    title: 'e.g. Supply and setup of office computers and network equipment',
    scope: 'e.g. 10 desktop units, a managed switch, and setup/configuration on site.',
    quantity: 'e.g. 10 units, 1 switch',
  },
  'Vehicle Parts & Services': {
    title: 'e.g. Supply of brake parts for a fleet of delivery vans',
    scope: 'e.g. Brake pads and rotors for 5 vans, Toyota Hiace 2019-2022 models.',
    quantity: 'e.g. 5 sets',
  },
  'Packaging & Labeling': {
    title: 'e.g. Custom corrugated boxes for product shipping',
    scope: 'e.g. Printed corrugated boxes, double-wall, sized for a specific product line.',
    quantity: 'e.g. 5,000 pieces',
  },
  'Office & Janitorial Supplies': {
    title: 'e.g. Monthly supply of office and cleaning supplies',
    scope: 'e.g. Bond paper, cleaning chemicals, and janitorial consumables, delivered monthly.',
    quantity: 'e.g. Monthly, per attached list',
  },
};
const DEFAULT_DETAILS_EXAMPLE = DETAILS_EXAMPLE_BY_CATEGORY['Fabrication & Manufacturing'];

const TIME_OPTIONS: { value: string; label: string }[] = [
  { value: '09:00', label: '9:00 AM' },
  { value: '12:00', label: '12:00 PM' },
  { value: '15:00', label: '3:00 PM' },
  { value: '17:00', label: '5:00 PM' },
  { value: '18:00', label: '6:00 PM' },
  { value: '21:00', label: '9:00 PM' },
];

const CLOSING_PRESETS: { label: string; days: number }[] = [
  { label: '+3 days', days: 3 },
  { label: '+1 week', days: 7 },
  { label: '+2 weeks', days: 14 },
  { label: '+1 month', days: 30 },
];

/** Matches RequirementDetail.tsx's OWNER_SEALED EditabilityList exactly. */
const LOCK_ITEMS = [
  { name: 'Scope and specifications', body: 'Respondents price against exactly what you posted — changing it after publish would invalidate quotations already sealed against it.' },
  { name: 'Quantity', body: 'A different quantity is a different job. Post a new requirement instead of changing this one underneath respondents.' },
  { name: 'Indicative budget', body: 'Shown to every respondent before they price. Moving it after publish would be moving the target they already aimed at.' },
  { name: 'Closing date and time', body: 'The only field that alerts the platform. It fires that event once, on publish, and cannot be moved afterward.' },
];

/** Caps the scrollable step column — same value Onboarding.tsx's shellInner uses. */
const FORM_CONTENT_MAX_WIDTH = 680;

/* ─── Formatting helpers ─────────────────────────────── */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function formatDateTime(iso: ISODateTime): string {
  const d = new Date(iso);
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${formatDate(iso)}, ${h}:${mm} ${ampm}`;
}

function formatWindow(fromDate: string, toDate: string): string {
  if (!fromDate || !toDate) return 'Not set';
  const a = new Date(`${fromDate}T00:00:00`);
  const b = new Date(`${toDate}T00:00:00`);
  return `${a.getDate()} ${MONTHS[a.getMonth()]} — ${b.getDate()} ${MONTHS[b.getMonth()]} ${b.getFullYear()}`;
}

function withCommas(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatPHP(amount: number): string {
  return `₱${withCommas(amount)}`;
}

function formatBudget(min: number | null, max: number | null): string {
  if (min !== null && max !== null) return `${formatPHP(min)} – ${formatPHP(max)}`;
  if (min !== null) return `From ${formatPHP(min)}`;
  if (max !== null) return `Up to ${formatPHP(max)}`;
  return 'Not specified';
}

function num(v: string): number | null {
  const cleaned = v.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

/** Strips anything but digits and a single decimal point, so numeric fields can't
 *  hold letters or symbols no matter what a device's keyboard allows through. */
function sanitizeNumeric(v: string): string {
  const cleaned = v.replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot === -1) return cleaned;
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
}

/** Catches placeholder-mashing that clears a plain "is it empty" check but isn't a
 *  real specification: the same character repeated ("aaaa", "......"), or a string
 *  with no letter or digit in it at all (only symbols/whitespace). Doesn't try to
 *  detect every kind of gibberish — just the two shapes someone idly typing into a
 *  form actually produces. */
function isLikelyJunk(v: string): boolean {
  const t = v.trim();
  if (!t) return false; // emptiness is its own, separate check
  if (!/[a-zA-Z0-9]/.test(t)) return true;
  if (/^(.)\1*$/.test(t)) return true;
  return false;
}

function pluralUnit(n: number, w: string): string {
  return `${n} ${w}${n === 1 ? '' : 's'}`;
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${pluralUnit(days, 'day')}, ${pluralUnit(hours, 'hour')}`;
  if (hours > 0) return `${pluralUnit(hours, 'hour')}, ${pluralUnit(minutes, 'minute')}`;
  return pluralUnit(Math.max(minutes, 0), 'minute');
}

function daysFromNowDateString(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Rejects strings that merely look like a date ("2026-02-30") in addition to ones
 *  that don't — `new Date(...)` alone silently rolls invalid days into the next month. */
function isValidDateString(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

function buildClosingISO(dateStr: string, timeValue: string): ISODateTime {
  if (!dateStr) return '';
  return `${dateStr}T${timeValue}:00+08:00`;
}

function listOut(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function buildDraftInput(details: RequirementDetailsDraft, delivery: RequirementDeliveryDraft, closing: RequirementClosingDraft): RequirementDraftInput {
  return {
    category: details.category,
    title: details.title,
    scope: details.scope,
    specifications: details.specifications,
    quantity: details.quantity,
    budgetMin: details.budgetMin,
    budgetMax: details.budgetMax,
    requiredDocuments: details.requiredDocuments,
    deliveryCity: delivery.city,
    deliveryAddress: delivery.address,
    deliveryWindowFrom: delivery.windowFrom,
    deliveryWindowTo: delivery.windowTo,
    attachments: delivery.attachments,
    closingAt: buildClosingISO(closing.closeDate, closing.closeTime),
  };
}

/* ─── Small building blocks ─────────────────────────── */

function SectionLabel({ children, tone }: { children: string; tone?: string }) {
  return <Text style={[styles.sectionLabel, tone ? { color: tone } : null]}>{children}</Text>;
}

function Pill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.pill, active ? styles.pillActive : null]}>
      <Text style={[styles.pillLabel, active ? styles.pillLabelActive : null]}>{label}</Text>
    </Pressable>
  );
}

function XGlyph({ tone }: { tone: string }) {
  return (
    <View style={styles.xGlyph}>
      <View style={[styles.xGlyphBar, { backgroundColor: tone, transform: [{ rotate: '45deg' }] }]} />
      <View style={[styles.xGlyphBar, { backgroundColor: tone, transform: [{ rotate: '-45deg' }] }]} />
    </View>
  );
}

function CheckGlyph() {
  return <View style={styles.checkGlyph} />;
}

function AddDashedButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.addDashed}>
      <Text style={styles.addDashedLabel}>+ {label}</Text>
    </Pressable>
  );
}

/** Picker-only — no free typing, so the field can never hold anything but a real date
 *  (or nothing). On web this is a genuine native `<input type="date">` (a raw DOM
 *  element — react-native-web renders it straight through to the browser), not a proxy
 *  View standing in front of a hidden input: an attempt at the latter left the browser's
 *  calendar popup pinned to the top-left corner no matter how the hidden input was
 *  positioned, since the popup anchors to the input's own on-screen box, and a real
 *  visible input always has a correct one — there's nothing left to get wrong. Native has
 *  no calendar widget without a native-only dependency, so it shows a disabled-looking
 *  field with a note instead of a dead tap target. */
function DateField({
  value,
  onPick,
  placeholder,
  error,
}: {
  value: string;
  onPick: (value: string) => void;
  placeholder: string;
  error?: boolean;
}) {
  const webAvailable = typeof document !== 'undefined' && typeof document.createElement === 'function';

  if (webAvailable) {
    return (
      <input
        type="date"
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onPick(e.target.value)}
        style={{
          flex: 1,
          minWidth: 140,
          marginTop: 0,
          fontFamily: font.monoMedium,
          fontSize: fontSize.base,
          color: color.ink,
          background: color.canvas,
          border: `1px solid ${error ? color.dangerBorder : color.border}`,
          borderRadius: radius.lg,
          paddingLeft: space.md,
          paddingRight: space.md,
          paddingTop: space.sm,
          paddingBottom: space.sm,
          outline: 'none',
        }}
      />
    );
  }

  return (
    <View style={[styles.input, styles.dateField, error ? styles.inputError : null]}>
      <Text style={[styles.dateFieldText, !value ? styles.dateFieldPlaceholder : null]}>
        {value ? formatDate(`${value}T00:00:00`) : `${placeholder} — pick on web`}
      </Text>
    </View>
  );
}

interface SpecRowDraft {
  id: string;
  label: string;
  value: string;
}

function SpecificationEditRow({
  row,
  invalid,
  labelPlaceholder,
  valuePlaceholder,
  onChangeLabel,
  onChangeValue,
  onRemove,
}: {
  row: SpecRowDraft;
  invalid?: boolean;
  labelPlaceholder?: string;
  valuePlaceholder?: string;
  onChangeLabel: (v: string) => void;
  onChangeValue: (v: string) => void;
  onRemove: () => void;
}) {
  return (
    <View>
      <View style={styles.specEditRow}>
        <TextInput
          value={row.label}
          onChangeText={onChangeLabel}
          maxLength={SPEC_LABEL_MAX}
          placeholder={labelPlaceholder ?? DEFAULT_SPEC_EXAMPLE.label}
          placeholderTextColor={color.inkFaint}
          style={[styles.input, styles.specEditLabelInput, invalid ? styles.inputError : null]}
        />
        <TextInput
          value={row.value}
          onChangeText={onChangeValue}
          maxLength={SPEC_VALUE_MAX}
          placeholder={valuePlaceholder ?? DEFAULT_SPEC_EXAMPLE.value}
          placeholderTextColor={color.inkFaint}
          style={[styles.input, styles.specEditValueInput, invalid ? styles.inputError : null]}
        />
        <Pressable onPress={onRemove} style={styles.specEditRemove} hitSlop={8}>
          <XGlyph tone={color.inkFaint} />
        </Pressable>
      </View>
      {invalid && (
        <Text style={styles.errorText}>
          Needs at least {SPEC_LABEL_MIN} real characters on each side — not just symbols or a repeated letter.
        </Text>
      )}
    </View>
  );
}

type ActionVariant = 'primary' | 'outline' | 'text';

function ActionButton({
  label,
  onPress,
  variant = 'outline',
  disabled = false,
}: {
  label: string;
  onPress?: () => void;
  variant?: ActionVariant;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.actionButton,
        {
          backgroundColor: variant === 'primary' ? (pressed ? color.primaryPressed : color.primary) : variant === 'text' ? 'transparent' : color.surface,
          borderColor: variant === 'outline' ? color.border : variant === 'text' ? 'transparent' : color.primary,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Text style={[styles.actionButtonLabel, { color: variant === 'primary' ? color.onPrimary : variant === 'text' ? color.inkMuted : color.ink }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function SummaryBanner({ message }: { message: string }) {
  return (
    <View style={styles.summaryBanner}>
      <View style={styles.summaryDot} />
      <Text style={styles.summaryText}>{message}</Text>
    </View>
  );
}

function FieldLabel({ children, optional }: { children: string; optional?: boolean }) {
  return (
    <Text style={styles.fieldLabel}>
      {children}
      {optional && <Text style={styles.fieldLabelOptional}> — optional</Text>}
    </Text>
  );
}

function FormDivider() {
  return <View style={styles.formDivider} />;
}

function ScreenTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text style={styles.pageTitle}>{title}</Text>
      <Text style={styles.pageSubtitle}>{subtitle}</Text>
    </View>
  );
}

/* ─── Step indicator: four segmented progress bars, label above each ──
 * Same shape as Onboarding.tsx's SegmentedSteps — completed segments filled, the current
 * one filled and stronger, future ones a muted track. */

const STEP_ORDER: PostRequirementState[] = ['DETAILS', 'DELIVERY', 'CLOSING', 'REVIEW'];
const STEP_LABELS: Record<PostRequirementState, string> = {
  DETAILS: 'Details',
  DELIVERY: 'Delivery',
  CLOSING: 'Closing',
  REVIEW: 'Review',
};

function SegmentedSteps({ step }: { step: PostRequirementState }) {
  const current = STEP_ORDER.indexOf(step);
  return (
    <View style={styles.segmentedSteps}>
      {STEP_ORDER.map((s, i) => {
        const now = i === current;
        const done = i < current;
        return (
          <View key={s} style={styles.segmentedStepItem}>
            <Text style={[styles.segmentedStepLabel, now ? styles.segmentedStepLabelNow : done ? styles.segmentedStepLabelDone : null]} numberOfLines={1}>
              {STEP_LABELS[s].toUpperCase()}
            </Text>
            <View style={styles.segmentedStepTrack}>
              {(now || done) && <View style={[styles.segmentedStepFill, now ? styles.segmentedStepFillNow : null]} />}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/* ─── Persistent shell header: breadcrumb, outside the scroll area ─────
 * Same structural role as Onboarding's shellHeader (full-width bar, bottom border,
 * screenPadding) — content is a breadcrumb here since this screen already sits inside the
 * app shell's own AppHeader, mounted once by app/_layout.tsx. */

function ShellHeader({ step, onExit }: { step: PostRequirementState; onExit?: () => void }) {
  return (
    <View style={styles.shellHeader}>
      <View style={styles.breadcrumbRow}>
        <Pressable onPress={onExit} hitSlop={6}>
          <Text style={styles.breadcrumbLink}>My Requirements</Text>
        </Pressable>
        <Text style={styles.breadcrumbSep}>/</Text>
        <Text style={[styles.breadcrumbLink, step !== 'REVIEW' ? styles.breadcrumbCurrent : null]}>New requirement</Text>
        {step === 'REVIEW' && (
          <>
            <Text style={styles.breadcrumbSep}>/</Text>
            <Text style={styles.breadcrumbCurrent}>Review and publish</Text>
          </>
        )}
      </View>
    </View>
  );
}

/* ─── Fixed bottom bar ───────────────────────────────
 * Back (from step two onward) on the left, the segmented step indicator centred, the
 * primary action on the right — same three-column layout as Onboarding.tsx's BottomBar, so
 * the centre stays centred whether or not Back is present. No secondary actions beyond
 * these two, per step. */

function BottomBar({
  step,
  onLeft,
  leftLabel,
  onPrimary,
  primaryLabel,
  primaryDisabled = false,
}: {
  step: PostRequirementState;
  onLeft?: () => void;
  leftLabel: string;
  onPrimary: () => void;
  primaryLabel: string;
  primaryDisabled?: boolean;
}) {
  return (
    <View style={styles.bottomBar}>
      <View style={styles.bottomBarInner}>
        <View style={styles.bottomBarSide}>
          {onLeft && (
            <Pressable onPress={onLeft} hitSlop={6}>
              <Text style={styles.backLink}>{leftLabel}</Text>
            </Pressable>
          )}
        </View>
        <View style={styles.bottomBarCenter}>
          <SegmentedSteps step={step} />
        </View>
        <View style={[styles.bottomBarSide, styles.bottomBarSideRight]}>
          <ActionButton label={primaryLabel} variant="primary" onPress={onPrimary} disabled={primaryDisabled} />
        </View>
      </View>
    </View>
  );
}

/* ─── STEP 1 — DETAILS ───────────────────────────────
 * Category, title, scope, specifications, quantity, indicative budget. Nothing about
 * location, dates, attachments, or closing. */

function DetailsScreen({ poster, initial, onContinue, reportContinue, onSuggestCategory }: DetailsProps & { reportContinue: (fn: () => void) => void }) {
  const [category, setCategory] = useState(initial?.category ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [scope, setScope] = useState(initial?.scope ?? '');
  // Auto-tag suggestion — checked once the buyer has written enough of the
  // title and scope to classify, purely a hint under the Category pills.
  // Never overrides a category the buyer already picked themselves.
  const [suggestedCategory, setSuggestedCategory] = useState<string | null>(null);
  const suggestionCheckedFor = useRef<string | null>(null);

  async function checkCategorySuggestion(currentTitle: string, currentScope: string) {
    if (!onSuggestCategory || category) return;
    if (currentTitle.trim().length < TITLE_MIN || currentScope.trim().length < SCOPE_MIN) return;
    const key = `${currentTitle.trim()}|${currentScope.trim()}`;
    if (suggestionCheckedFor.current === key) return;
    suggestionCheckedFor.current = key;
    const result = await onSuggestCategory(currentTitle.trim(), currentScope.trim());
    if (suggestionCheckedFor.current === key) setSuggestedCategory(result);
  }
  const [specRows, setSpecRows] = useState<SpecRowDraft[]>(
    () => (initial?.specifications ?? []).map((s, i) => ({ id: `spec-init-${i}`, label: s.label, value: s.value })),
  );
  const [quantity, setQuantity] = useState(initial?.quantity ?? '');
  const [budgetMinText, setBudgetMinText] = useState(initial?.budgetMin != null ? String(initial.budgetMin) : '');
  const [budgetMaxText, setBudgetMaxText] = useState(initial?.budgetMax != null ? String(initial.budgetMax) : '');
  const [requiredDocuments, setRequiredDocuments] = useState<string[]>(initial?.requiredDocuments ?? []);
  const [docInput, setDocInput] = useState('');
  const [attempted, setAttempted] = useState(false);

  function addRequiredDoc() {
    const v = docInput.trim();
    if (!v) return;
    setRequiredDocuments((prev) => (prev.includes(v) ? prev : [...prev, v]));
    setDocInput('');
  }
  function removeRequiredDoc(v: string) {
    setRequiredDocuments((prev) => prev.filter((x) => x !== v));
  }
  function addSuggestedDoc(v: string) {
    setRequiredDocuments((prev) => (prev.includes(v) ? prev : [...prev, v]));
  }
  // Typical-for-this-category docs not yet in the list — tappable chips so
  // adding one is a single tap, not type-then-press-Add, and the input's
  // own placeholder mirrors the first of these instead of always showing
  // the same generic example regardless of category.
  const suggestedRemainingDocs = (REQUIRED_DOCS_BY_CATEGORY[category] ?? []).filter(
    (d) => !requiredDocuments.includes(d),
  );
  const detailsExample = DETAILS_EXAMPLE_BY_CATEGORY[category] ?? DEFAULT_DETAILS_EXAMPLE;

  function selectCategory(c: string) {
    setCategory(c);
    // Suggestion, not a mandate (the field stays optional per the study's
    // Scope and Delimitation) — only pre-fills while the buyer hasn't added
    // or removed anything here yet, so it never overwrites their own edits.
    setRequiredDocuments((prev) => (prev.length === 0 ? (REQUIRED_DOCS_BY_CATEGORY[c] ?? prev) : prev));
  }

  const budgetMin = num(budgetMinText);
  const budgetMax = num(budgetMaxText);
  const budgetReversed = budgetMin !== null && budgetMax !== null && budgetMin > budgetMax;

  const addSpecRow = () => setSpecRows((prev) => [...prev, { id: `spec${Date.now()}`, label: '', value: '' }]);
  const removeSpecRow = (id: string) => setSpecRows((prev) => prev.filter((r) => r.id !== id));
  const updateSpecRow = (id: string, field: 'label' | 'value', v: string) =>
    setSpecRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: v } : r)));

  const filledSpecRows = specRows.filter((r) => r.label.trim() && r.value.trim());

  /** A row only counts once BOTH sides clear length and look like real content —
   *  not just non-empty (a single stray character used to be enough to pass). */
  function isSpecRowValid(r: SpecRowDraft): boolean {
    const label = r.label.trim();
    const value = r.value.trim();
    return (
      label.length >= SPEC_LABEL_MIN && value.length >= SPEC_VALUE_MIN &&
      !isLikelyJunk(label) && !isLikelyJunk(value)
    );
  }
  const validSpecRows = specRows.filter(isSpecRowValid);
  const badSpecRows = filledSpecRows.filter((r) => !isSpecRowValid(r));

  const titleTooShort = title.trim().length > 0 && title.trim().length < TITLE_MIN;
  const scopeTooShort = scope.trim().length > 0 && scope.trim().length < SCOPE_MIN;

  const missing: string[] = [];
  if (!category) missing.push('a category');
  if (!title.trim()) missing.push('a title');
  else if (titleTooShort) missing.push(`a title of at least ${TITLE_MIN} characters`);
  if (!scope.trim()) missing.push('scope');
  else if (scopeTooShort) missing.push(`scope of at least ${SCOPE_MIN} characters`);
  if (validSpecRows.length === 0) missing.push('at least one real specification');
  else if (badSpecRows.length > 0) missing.push('a fix to the specification row marked below');
  if (!quantity.trim()) missing.push('quantity');
  if (requiredDocuments.length === 0) missing.push('at least one required document');

  const ready = missing.length === 0 && !budgetReversed;

  const handleContinue = () => {
    if (!ready) {
      setAttempted(true);
      return;
    }
    onContinue({
      category,
      title: title.trim(),
      scope: scope.trim(),
      specifications: validSpecRows.map((r) => ({ label: r.label.trim(), value: r.value.trim() })),
      quantity: quantity.trim(),
      budgetMin,
      budgetMax,
      requiredDocuments,
    });
  };
  reportContinue(handleContinue);

  return (
    <View style={styles.stepContent}>
      <ScreenTitle
        title="Post a requirement"
        subtitle={`Verified businesses in your category and service area are alerted the moment ${poster.displayName ?? poster.registeredName} publishes.`}
      />
      {attempted && missing.length > 0 && <SummaryBanner message={`Still needed before you continue: ${listOut(missing)}.`} />}

      <View style={{ gap: space.lg }}>
        <View>
          <FieldLabel>Category</FieldLabel>
          <View style={styles.pillGroupWrap}>
            {CATEGORIES.map((c) => (
              <Pill key={c} label={c} active={category === c} onPress={() => selectCategory(c)} />
            ))}
          </View>
          {!category && suggestedCategory && (
            <Pressable onPress={() => setCategory(suggestedCategory)}>
              <Text style={styles.fieldCaption}>Based on your title and scope, this looks like "{suggestedCategory}" — tap to use it.</Text>
            </Pressable>
          )}
        </View>

        <View>
          <FieldLabel>Title</FieldLabel>
          <TextInput
            value={title}
            onChangeText={setTitle}
            onBlur={() => void checkCategorySuggestion(title, scope)}
            maxLength={TITLE_MAX}
            placeholder={detailsExample.title}
            placeholderTextColor={color.inkFaint}
            style={[styles.input, attempted && titleTooShort ? styles.inputError : null]}
          />
          {attempted && titleTooShort && (
            <Text style={styles.errorText}>Needs at least {TITLE_MIN} characters ({title.trim().length}/{TITLE_MIN}).</Text>
          )}
        </View>

        <View>
          <FieldLabel>Scope</FieldLabel>
          <TextInput
            value={scope}
            onChangeText={setScope}
            onBlur={() => void checkCategorySuggestion(title, scope)}
            multiline
            numberOfLines={6}
            maxLength={SCOPE_MAX}
            placeholder={detailsExample.scope}
            placeholderTextColor={color.inkFaint}
            style={[styles.textareaLarge, attempted && scopeTooShort ? styles.inputError : null]}
          />
          {attempted && scopeTooShort ? (
            <Text style={styles.errorText}>Needs at least {SCOPE_MIN} characters ({scope.trim().length}/{SCOPE_MIN}).</Text>
          ) : (
            <Text style={styles.fieldCaption}>Vague scope produces quotations you cannot compare.</Text>
          )}
        </View>

        <View>
          <FieldLabel>Specifications</FieldLabel>
          <Text style={styles.fieldCaption}>Materials, dimensions, standards, finish — whatever a business needs to price accurately, as labelled rows.</Text>
          <View style={{ gap: space.sm, marginTop: space.sm }}>
            {specRows.map((row) => (
              <SpecificationEditRow
                key={row.id}
                row={row}
                invalid={attempted && row.label.trim() !== '' && row.value.trim() !== '' && !isSpecRowValid(row)}
                labelPlaceholder={(SPEC_EXAMPLE_BY_CATEGORY[category] ?? DEFAULT_SPEC_EXAMPLE).label}
                valuePlaceholder={(SPEC_EXAMPLE_BY_CATEGORY[category] ?? DEFAULT_SPEC_EXAMPLE).value}
                onChangeLabel={(v) => updateSpecRow(row.id, 'label', v)}
                onChangeValue={(v) => updateSpecRow(row.id, 'value', v)}
                onRemove={() => removeSpecRow(row.id)}
              />
            ))}
          </View>
          <View style={{ marginTop: space.sm }}>
            <AddDashedButton label="Add specification" onPress={addSpecRow} />
          </View>
        </View>

        <View>
          <FieldLabel>Required documents</FieldLabel>
          <Text style={styles.fieldCaption}>Qualifying documents each respondent should attach to their quotation — e.g. PCAB License, Sanitary Permit. Add at least one.</Text>
          <View style={styles.pillGroupWrap}>
            {requiredDocuments.map((d) => (
              <Pressable key={d} onPress={() => removeRequiredDoc(d)} style={[styles.pill, styles.pillActive]}>
                <Text style={[styles.pillLabel, styles.pillLabelActive]}>{d} ×</Text>
              </Pressable>
            ))}
          </View>
          {suggestedRemainingDocs.length > 0 && (
            <View style={[styles.pillGroupWrap, { marginTop: space.xs }]}>
              {suggestedRemainingDocs.map((d) => (
                <Pressable key={d} onPress={() => addSuggestedDoc(d)} style={styles.pill}>
                  <Text style={styles.pillLabel}>+ {d}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <View style={styles.addDocRow}>
            <TextInput
              value={docInput}
              onChangeText={setDocInput}
              onSubmitEditing={addRequiredDoc}
              placeholder="Or type your own"
              placeholderTextColor={color.inkFaint}
              style={[styles.input, { flex: 1, marginTop: 0 }]}
            />
            <ActionButton label="Add" variant="outline" onPress={addRequiredDoc} />
          </View>
        </View>

        <FormDivider />

        <View style={styles.twoColRow}>
          <View style={styles.twoCol}>
            <FieldLabel>Quantity</FieldLabel>
            <TextInput
              value={quantity}
              onChangeText={setQuantity}
              maxLength={QUANTITY_MAX}
              placeholder={detailsExample.quantity}
              placeholderTextColor={color.inkFaint}
              style={styles.input}
            />
          </View>
          <View style={styles.twoCol}>
            <FieldLabel optional>Indicative budget</FieldLabel>
            <View style={styles.budgetRow}>
              <View style={[styles.budgetField, attempted && budgetReversed ? styles.inputError : null]}>
                <Text style={styles.budgetCurrency}>₱</Text>
                <TextInput
                  value={budgetMinText}
                  onChangeText={(v) => setBudgetMinText(sanitizeNumeric(v))}
                  placeholder="From"
                  placeholderTextColor={color.inkFaint}
                  keyboardType="decimal-pad"
                  style={styles.budgetInput}
                />
              </View>
              <Text style={styles.budgetSep}>—</Text>
              <View style={[styles.budgetField, attempted && budgetReversed ? styles.inputError : null]}>
                <Text style={styles.budgetCurrency}>₱</Text>
                <TextInput
                  value={budgetMaxText}
                  onChangeText={(v) => setBudgetMaxText(sanitizeNumeric(v))}
                  placeholder="To"
                  placeholderTextColor={color.inkFaint}
                  keyboardType="decimal-pad"
                  style={styles.budgetInput}
                />
              </View>
            </View>
            {attempted && budgetReversed && <Text style={styles.errorText}>That reads as a smaller maximum than minimum.</Text>}
          </View>
        </View>
      </View>
    </View>
  );
}

/* ─── STEP 2 — DELIVERY ──────────────────────────────
 * City/municipality beside site address, start date beside end date, attachments. */

/** Web: an actual picked Blob, stashed here keyed by the Attachment id it generated, so
 *  app/post-requirement.tsx can find the real bytes to upload after the requirement is
 *  created (a requirement needs an id before POST /requirements/{id}/attachments can be
 *  called, so publishing and uploading are necessarily two separate steps). Native builds
 *  fall back to placeholder metadata further down — same split, same reasoning, as
 *  Onboarding.tsx's pickedDocumentFiles. */
export const pickedRequirementFiles = new Map<string, File>();

function DeliveryScreen({ initial, onContinue, reportContinue }: DeliveryProps & { reportContinue: (fn: () => void) => void }) {
  const [city, setCity] = useState(initial?.city ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [windowFrom, setWindowFrom] = useState(initial?.windowFrom ?? '');
  const [windowTo, setWindowTo] = useState(initial?.windowTo ?? '');
  const [attachments, setAttachments] = useState<Attachment[]>(initial?.attachments ?? []);
  const [attempted, setAttempted] = useState(false);

  const cityInvalid = !!city.trim() && !isRecognizedCity(city);
  // DateField only ever writes a real picked date, so these mainly guard the native
  // fallback (no picker there yet — see DateField's comment above).
  const windowFromInvalid = !!windowFrom && !isValidDateString(windowFrom);
  const windowToInvalid = !!windowTo && !isValidDateString(windowTo);
  const windowBad =
    !!windowFrom && !!windowTo && !windowFromInvalid && !windowToInvalid && new Date(windowTo) < new Date(windowFrom);

  const missing: string[] = [];
  if (!city.trim()) missing.push('city / municipality');
  if (!address.trim()) missing.push('site address');
  if (!windowFrom || !windowTo) missing.push('a delivery window');

  const ready = missing.length === 0 && !windowBad && !windowFromInvalid && !windowToInvalid && !cityInvalid;

  const addFile = async () => {
    if (isWebFilePickerSupported()) {
      const picked = await pickWebFile('.pdf,.doc,.docx,.jpg,.jpeg,.png,application/pdf,image/*');
      if (!picked) return; // dialog closed without picking — do nothing, same as before
      const id = `att-${Date.now()}`;
      pickedRequirementFiles.set(id, picked);
      setAttachments((prev) => [
        ...prev,
        { id, filename: picked.name, sizeBytes: picked.size, mimeType: picked.type, uri: '', documentLabel: null },
      ]);
      return;
    }

    // Native fallback — placeholder metadata only, no real bytes. Same escape hatch as
    // Onboarding.tsx's capture(); a native file picker is a separate follow-up.
    setAttachments((prev) => [
      ...prev,
      { id: `f${Date.now()}`, filename: 'New attachment.pdf', sizeBytes: 640_000, mimeType: 'application/pdf', uri: '', documentLabel: null },
    ]);
  };
  const removeFile = (id: string) => {
    setAttachments((prev) => prev.filter((f) => f.id !== id));
    pickedRequirementFiles.delete(id);
  };

  const handleContinue = () => {
    if (!ready) {
      setAttempted(true);
      return;
    }
    onContinue({ city: city.trim(), address: address.trim(), windowFrom, windowTo, attachments });
  };
  reportContinue(handleContinue);

  return (
    <View style={styles.stepContent}>
      <ScreenTitle title="Where and when" subtitle="The delivery location and the window respondents should plan around." />
      {attempted && missing.length > 0 && <SummaryBanner message={`Still needed before you continue: ${listOut(missing)}.`} />}

      <View style={{ gap: space.lg }}>
        <View style={styles.twoColRow}>
          <View style={styles.twoCol}>
            <FieldLabel>City / Municipality</FieldLabel>
            <TextInput
              value={city}
              onChangeText={setCity}
              placeholder="Calamba"
              placeholderTextColor={color.inkFaint}
              style={[styles.input, attempted && cityInvalid ? styles.inputError : null]}
            />
            {attempted && cityInvalid && (
              <Text style={styles.errorText}>We don't recognize that city — check the spelling (e.g. "Calamba", "Quezon City").</Text>
            )}
          </View>
          <View style={{ flexGrow: 2, flexBasis: 260, minWidth: 200 }}>
            <FieldLabel>Site address</FieldLabel>
            <TextInput
              value={address}
              onChangeText={setAddress}
              maxLength={SITE_ADDRESS_MAX}
              placeholder="Barangay Canlubang, Calamba, Laguna"
              placeholderTextColor={color.inkFaint}
              style={[styles.input, attempted && !address.trim() ? styles.inputError : null]}
            />
          </View>
        </View>

        <View>
          <FieldLabel>Delivery window</FieldLabel>
          <View style={styles.dateRangeRow}>
            <DateField
              value={windowFrom}
              onPick={setWindowFrom}
              placeholder="Start date"
              error={attempted && (windowBad || windowFromInvalid)}
            />
            <Text style={styles.toLabel}>to</Text>
            <DateField
              value={windowTo}
              onPick={setWindowTo}
              placeholder="End date"
              error={attempted && (windowBad || windowToInvalid)}
            />
          </View>
          {attempted && windowBad && <Text style={styles.errorText}>The end date is before the start date.</Text>}
          {attempted && !windowBad && (windowFromInvalid || windowToInvalid) && (
            <Text style={styles.errorText}>Pick a date using the calendar field.</Text>
          )}
        </View>

        <View>
          <FieldLabel optional>Attachments</FieldLabel>
          <Text style={styles.fieldCaption}>Reference files for anyone viewing this requirement — e.g. a floor plan, product photo, or spec sheet. Visible to every business browsing it, not just respondents.</Text>
          <View style={styles.pillGroupWrap}>
            {attachments.map((f) => (
              <View key={f.id} style={styles.fileChip}>
                <Text style={styles.fileChipName} numberOfLines={1}>{f.filename}</Text>
                <Pressable onPress={() => removeFile(f.id)} hitSlop={8}>
                  <XGlyph tone={color.inkFaint} />
                </Pressable>
              </View>
            ))}
            <AddDashedButton label="Add file" onPress={addFile} />
          </View>
        </View>
      </View>
    </View>
  );
}

/* ─── STEP 3 — CLOSING ───────────────────────────────
 * Closing date, closing time, quick duration presets — the highest-weight field on the
 * whole flow, called out once, plainly, as unchangeable after publish. */

function ClosingScreen({ initial, onContinue, reportContinue }: ClosingProps & { reportContinue: (fn: () => void) => void }) {
  const [closeDate, setCloseDate] = useState(initial?.closeDate ?? '');
  const [closeTime, setCloseTime] = useState(initial?.closeTime ?? '17:00');
  const [attempted, setAttempted] = useState(false);

  const closingAt = buildClosingISO(closeDate, closeTime);
  const closingMs = closeDate ? new Date(closingAt).getTime() - Date.now() : 0;
  const closingInPast = !!closeDate && closingMs <= 0;

  const missing: string[] = [];
  if (!closeDate) missing.push('a closing date');

  const ready = missing.length === 0 && !closingInPast;

  const applyPreset = (days: number) => setCloseDate(daysFromNowDateString(days));

  const handleContinue = () => {
    if (!ready) {
      setAttempted(true);
      return;
    }
    onContinue({ closeDate, closeTime });
  };
  reportContinue(handleContinue);

  const duration = closeDate ? formatDuration(closingMs) : null;
  const urgent = !!closeDate && !closingInPast && closingMs < 48 * 3600_000;
  const leadColor = closingInPast ? color.danger : urgent ? color.danger : color.ink;

  let leadNote = 'Pick a closing date to see how much time businesses will have to quote.';
  if (closeDate && urgent) leadNote = 'Under two days to quote. Most requirements give businesses at least three.';
  else if (closeDate) leadNote = `Businesses will have ${duration} to prepare a quotation.`;

  return (
    <View style={styles.stepContent}>
      <ScreenTitle
        title="Set your quotation closing time"
        subtitle="Once the requirement closes, no new quotations can be submitted and sealed quotations are released simultaneously."
      />
      {attempted && missing.length > 0 && <SummaryBanner message={`Still needed before you continue: ${listOut(missing)}.`} />}
      {attempted && closingInPast && <SummaryBanner message="This closes in the past — pick a later date and time." />}

      <View style={styles.closingCard}>
        <Text style={styles.closingLockNote}>
          <Text style={styles.ackBold}>Closing time cannot be changed after publishing.</Text> Choose a time that gives businesses
          enough room to prepare a competitive quotation.
        </Text>

        <View style={styles.pillGroupWrap}>
          {CLOSING_PRESETS.map((p) => (
            <Pill key={p.label} label={p.label} active={closeDate === daysFromNowDateString(p.days)} onPress={() => applyPreset(p.days)} />
          ))}
        </View>

        <View style={styles.dateRangeRow}>
          <DateField value={closeDate} onPick={setCloseDate} placeholder="Closing date" error={attempted && closingInPast} />
          <View style={styles.pillGroupWrap}>
            {TIME_OPTIONS.map((t) => (
              <Pill key={t.value} label={t.label} active={closeTime === t.value} onPress={() => setCloseTime(t.value)} />
            ))}
          </View>
        </View>

        <View style={styles.closingStampRow}>
          <View style={{ minWidth: 0 }}>
            <SectionLabel>Quotations close</SectionLabel>
            <Text style={styles.closingStampValue}>{closeDate ? formatDateTime(closingAt) : 'Not set'}</Text>
          </View>
          <View style={styles.closingStampDivider} />
          <View style={{ minWidth: 0 }}>
            <SectionLabel>Time to quote</SectionLabel>
            <Text style={[styles.closingStampValue, { color: leadColor }]}>{closeDate ? (closingInPast ? 'Already closed' : (duration ?? '—')) : '—'}</Text>
          </View>
        </View>

        <Text style={[styles.closingNote, { color: leadColor === color.danger ? color.danger : color.inkMuted }]}>{leadNote}</Text>
      </View>
    </View>
  );
}

/* ─── STEP 4 — REVIEW ────────────────────────────────
 * A read-only summary grouped as What you need / Where and when / Closing, a sealed-
 * quotations explanation, and the existing lock list + acknowledgment. */

function SummaryGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <SectionLabel>{title}</SectionLabel>
      {children}
    </View>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryLine}>
      <Text style={styles.summaryLineLabel}>{label}</Text>
      <Text style={styles.summaryLineValue}>{value || '—'}</Text>
    </View>
  );
}

function SummaryBlock({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text style={styles.summaryLineLabel}>{label}</Text>
      <Text style={styles.summaryBlockValue}>{value || '—'}</Text>
    </View>
  );
}

function SealedExplanationCard({ closingAt }: { closingAt: ISODateTime }) {
  return (
    <View style={styles.sealedCard}>
      <SectionLabel tone={color.primary}>Sealed until closing</SectionLabel>
      <Text style={styles.sealedHeading}>Quotations stay sealed until closing</Text>
      <Text style={styles.sealedBody}>
        Every quotation submitted before {formatDateTime(closingAt)} stays hidden — from you, and from every other business quoting.
        At closing, every sealed quotation opens at once, so no business ever prices against one it was never allowed to see.
      </Text>
    </View>
  );
}

function BeforePublishCard({ draft, ack, onToggleAck }: { draft: RequirementDraftInput; ack: boolean; onToggleAck: () => void }) {
  return (
    <View style={styles.beforePublishCard}>
      <SectionLabel tone={color.danger}>Before you publish</SectionLabel>
      <Text style={styles.beforePublishHeading}>Four things stop being editable the moment you publish.</Text>

      <View style={{ gap: space.md, marginTop: space.lg }}>
        {LOCK_ITEMS.map((l) => (
          <View key={l.name} style={styles.lockRow}>
            <View style={styles.lockIcon} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.lockName}>{l.name}</Text>
              <Text style={styles.lockBody}>{l.body}</Text>
            </View>
          </View>
        ))}
      </View>

      <Pressable onPress={onToggleAck} style={styles.ackRow}>
        <View style={[styles.checkbox, ack ? styles.checkboxOn : null]}>{ack && <CheckGlyph />}</View>
        <Text style={styles.ackText}>
          I understand that verified businesses in my category and service area will be alerted, that quotations stay sealed until{' '}
          <Text style={styles.ackBold}>{formatDateTime(draft.closingAt)}</Text>, and that scope and specifications, quantity, indicative
          budget, and the closing date and time cannot be changed once I publish.
        </Text>
      </Pressable>
    </View>
  );
}

function ReviewScreen({
  details,
  delivery,
  closing,
  onPublish,
  publishError,
  reportContinue,
  reportPrimaryEnabled,
}: ReviewProps & { reportContinue: (fn: () => void) => void; reportPrimaryEnabled?: (enabled: boolean) => void }) {
  const [ack, setAck] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const draft = buildDraftInput(details, delivery, closing);

  const handlePublish = () => {
    if (!ack) {
      setAttempted(true);
      return;
    }
    onPublish(draft);
  };
  reportContinue(handlePublish);

  // Belt-and-suspenders alongside the ack check inside handlePublish above:
  // the bottom bar's "Publish requirement" button is disabled outright while
  // unchecked, so there's no click-then-blocked round trip to notice — and no
  // way for a stale reportContinue registration (see the ghost-mount comment
  // on StepTransition) to slip a publish through with the button still live.
  useEffect(() => {
    reportPrimaryEnabled?.(ack);
  }, [ack, reportPrimaryEnabled]);

  const specText = draft.specifications.length > 0
    ? draft.specifications.map((s) => `${s.label}: ${s.value}`).join('\n')
    : '';
  const attachmentsText = draft.attachments.length > 0 ? draft.attachments.map((a) => a.filename).join(', ') : 'None';
  const locationText = draft.deliveryCity + (draft.deliveryAddress ? `, ${draft.deliveryAddress}` : '');

  return (
    <View style={styles.stepContent}>
      <ScreenTitle title="Review and publish" subtitle="Check the details below, then publish." />

      <View style={{ gap: space.lg }}>
        <SummaryGroup title="What you need">
          <SummaryLine label="Category" value={draft.category} />
          <SummaryLine label="Title" value={draft.title} />
          <SummaryBlock label="Scope" value={draft.scope} />
          {!!specText && <SummaryBlock label="Specifications" value={specText} />}
          <SummaryLine label="Quantity" value={draft.quantity} />
          <SummaryLine label="Indicative budget" value={formatBudget(draft.budgetMin, draft.budgetMax)} />
          <SummaryLine label="Required documents" value={draft.requiredDocuments.length > 0 ? draft.requiredDocuments.join(', ') : 'None'} />
        </SummaryGroup>

        <FormDivider />

        <SummaryGroup title="Where and when">
          <SummaryLine label="Location" value={locationText} />
          <SummaryLine label="Delivery window" value={formatWindow(draft.deliveryWindowFrom, draft.deliveryWindowTo)} />
          <SummaryLine label="Attachments" value={attachmentsText} />
        </SummaryGroup>

        <FormDivider />

        <SummaryGroup title="Closing">
          <SummaryLine label="Closes" value={formatDateTime(draft.closingAt)} />
        </SummaryGroup>
      </View>

      <SealedExplanationCard closingAt={draft.closingAt} />

      <BeforePublishCard draft={draft} ack={ack} onToggleAck={() => setAck((v) => !v)} />
      {attempted && !ack && <SummaryBanner message="Confirm the statement above to publish." />}
      {!!publishError && <SummaryBanner message={publishError} />}
    </View>
  );
}

/* ─── Step transition: horizontal slide + cross-fade ─────
 * Identical technique to Onboarding.tsx's StepTransition, over all four
 * PostRequirementState members. */

const STEP_TRANSITION_MS = 320;
const STEP_TRANSITION_EASING = Easing.inOut(Easing.cubic);

function StepTransition({ step, children }: { step: PostRequirementState; children: ReactNode }) {
  const orderRef = useRef(STEP_ORDER.indexOf(step));
  const lastRenderRef = useRef<ReactNode>(children);
  const [outgoing, setOutgoing] = useState<ReactNode>(null);
  const [width, setWidth] = useState(0);

  const incomingX = useSharedValue(0);
  const outgoingX = useSharedValue(0);
  const incomingOpacity = useSharedValue(1);
  const outgoingOpacity = useSharedValue(1);

  useEffect(() => {
    const newOrder = STEP_ORDER.indexOf(step);
    const prevOrder = orderRef.current;
    if (newOrder !== prevOrder) {
      const dir = newOrder > prevOrder ? 1 : -1;
      orderRef.current = newOrder;
      const distance = width || 480;
      const timing = { duration: STEP_TRANSITION_MS, easing: STEP_TRANSITION_EASING };

      setOutgoing(lastRenderRef.current);
      outgoingX.value = 0;
      outgoingOpacity.value = 1;
      outgoingX.value = withTiming(-dir * distance, timing, (finished) => {
        if (finished) runOnJS(setOutgoing)(null);
      });
      outgoingOpacity.value = withTiming(0, timing);

      incomingX.value = dir * distance;
      incomingOpacity.value = 0;
      incomingX.value = withTiming(0, timing);
      incomingOpacity.value = withTiming(1, timing);
    }
    lastRenderRef.current = children;
  });

  const incomingStyle = useAnimatedStyle(() => ({ transform: [{ translateX: incomingX.value }], opacity: incomingOpacity.value }));
  const outgoingStyle = useAnimatedStyle(() => ({ transform: [{ translateX: outgoingX.value }], opacity: outgoingOpacity.value }));

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  return (
    <View style={styles.stepTransitionWrap} onLayout={onLayout}>
      <Animated.View style={[styles.stepTransitionLayer, incomingStyle]}>{children}</Animated.View>
      {outgoing !== null && (
        <Animated.View style={[styles.stepTransitionLayer, styles.stepTransitionGhost, outgoingStyle]} pointerEvents="none">
          {outgoing}
        </Animated.View>
      )}
    </View>
  );
}

/* ─── Root component ─────────────────────────────────
 * Same shape as Onboarding's root: renders the persistent shell (header, scroll area,
 * fixed bottom bar) once — the same `PostRequirement` instance across every step change,
 * since the route always renders this same component with a new `state` prop rather than
 * swapping components. Only StepTransition's children (the active step's fields) get
 * swapped and animated; the primary action's actual handler lives inside whichever screen
 * is mounted, exposed to the persistent bottom bar via `reportContinue`. */

export default function PostRequirement(props: PostRequirementProps) {
  const primaryRef = useRef<() => void>(() => {});
  // REVIEW-only: whether "Publish requirement" is allowed to be pressed at all,
  // reported up from ReviewScreen's ack checkbox (see reportPrimaryEnabled
  // below). Ignored on every other step — those already gate on click via the
  // same attempted/missing pattern as everywhere else in this file.
  const [primaryEnabled, setPrimaryEnabled] = useState(true);
  // StepTransition keeps the departing screen mounted briefly as a "ghost" for its slide-
  // out animation (see StepTransition above). That ghost is a fresh mount of the same
  // screen component, so it re-runs reportContinue(handleContinue) too — with stale props
  // and reset local state — which would otherwise clobber primaryRef right after the real
  // incoming screen registered itself correctly. currentStepRef always holds the true
  // current step (set synchronously at the top of every real render, before the ghost's
  // effect-deferred mount can fire), so a ghost's registration — captured for a step that
  // no longer matches — is ignored instead of overwriting the live handler.
  const currentStepRef = useRef<PostRequirementState>(props.state);
  currentStepRef.current = props.state;

  const makeReportContinue = (step: PostRequirementState) => (fn: () => void) => {
    if (currentStepRef.current === step) {
      primaryRef.current = fn;
    }
  };

  let content: ReactNode;
  let leftLabel = '';
  let onLeft: (() => void) | undefined;
  let primaryLabel: string;
  let onExit: (() => void) | undefined;

  switch (props.state) {
    case 'DETAILS':
      content = <DetailsScreen {...props} reportContinue={makeReportContinue('DETAILS')} />;
      primaryLabel = 'Continue';
      break;
    case 'DELIVERY':
      content = <DeliveryScreen {...props} reportContinue={makeReportContinue('DELIVERY')} />;
      leftLabel = 'Back';
      onLeft = props.onBack;
      primaryLabel = 'Continue';
      break;
    case 'CLOSING':
      content = <ClosingScreen {...props} reportContinue={makeReportContinue('CLOSING')} />;
      leftLabel = 'Back';
      onLeft = props.onBack;
      primaryLabel = 'Review requirement';
      break;
    case 'REVIEW':
      content = (
        <ReviewScreen
          {...props}
          reportContinue={makeReportContinue('REVIEW')}
          reportPrimaryEnabled={setPrimaryEnabled}
        />
      );
      leftLabel = 'Back to edit';
      onLeft = props.onBack;
      primaryLabel = 'Publish requirement';
      onExit = props.onBack;
      break;
  }

  return (
    <View style={styles.root}>
      <ShellHeader step={props.state} onExit={onExit} />
      <ScreenScroll style={styles.shellScroll} contentContainerStyle={styles.shellScrollContent}>
        <View style={styles.shellInner}>
          <StepTransition step={props.state}>{content}</StepTransition>
        </View>
      </ScreenScroll>
      <BottomBar
        step={props.state}
        onLeft={onLeft}
        leftLabel={leftLabel}
        onPrimary={() => primaryRef.current()}
        primaryLabel={primaryLabel}
        primaryDisabled={props.state === 'REVIEW' && !primaryEnabled}
      />
    </View>
  );
}

/* ─── Styles ─────────────────────────────────────────── */

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },

  shellHeader: { width: '100%', paddingHorizontal: layout.screenPadding, paddingVertical: space.lg, backgroundColor: color.canvas, borderBottomWidth: 1, borderBottomColor: color.border },
  breadcrumbRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  breadcrumbLink: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkFaint },
  breadcrumbSep: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkFaint },
  breadcrumbCurrent: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted },

  shellScroll: { flex: 1 },
  shellScrollContent: { alignItems: 'center' },
  shellInner: { width: '100%', maxWidth: FORM_CONTENT_MAX_WIDTH, paddingHorizontal: layout.screenPadding, paddingTop: space.xxxl, paddingBottom: space.xxxl },

  bottomBar: { width: '100%', alignItems: 'center', backgroundColor: color.canvas, borderTopWidth: 1, borderTopColor: color.border },
  bottomBarInner: { width: '100%', maxWidth: layout.maxWidthWide, paddingHorizontal: layout.screenPadding, paddingVertical: space.md, flexDirection: 'row', alignItems: 'center', gap: space.md },
  bottomBarSide: { flex: 1, minWidth: 0, justifyContent: 'center' },
  bottomBarSideRight: { alignItems: 'flex-end' },
  bottomBarCenter: { flex: 1, alignItems: 'center', minWidth: 0 },
  backLink: { fontFamily: font.bodyMedium, fontSize: fontSize.base, color: color.inkMuted },

  segmentedSteps: { flexDirection: 'row', alignItems: 'flex-start', gap: space.lg, width: '100%', maxWidth: 480 },
  // minWidth is a floor, not a fixed size — flex: 1 still splits the row evenly
  // on wide screens. 76 was too high: 4 items + 3 gaps at space.lg (16) needs
  // 352px, which clips/overflows on real phones as narrow as 375px wide (after
  // the 20px screen padding on each side leaves only 335px). 56 keeps the same
  // total under 280px, fitting even a 320px-wide device with room to spare.
  segmentedStepItem: { flex: 1, minWidth: 56, gap: space.xs },
  segmentedStepLabel: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, color: color.inkFaint },
  segmentedStepLabelNow: { fontFamily: font.monoMedium, color: color.ink },
  segmentedStepLabelDone: { color: color.inkMuted },
  segmentedStepTrack: { height: 4, borderRadius: radius.pill, backgroundColor: color.border, overflow: 'hidden' },
  segmentedStepFill: { height: '100%', width: '100%', borderRadius: radius.pill, backgroundColor: color.primaryBorder },
  segmentedStepFillNow: { backgroundColor: color.primary },

  stepTransitionWrap: { width: '100%', position: 'relative', overflow: 'hidden' },
  stepTransitionLayer: { width: '100%' },
  stepTransitionGhost: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  stepContent: { gap: space.lg },

  pageTitle: { fontFamily: font.display, fontSize: fontSize.xl, lineHeight: lineHeight.xl, letterSpacing: letterSpacing.tight, color: color.ink },
  pageSubtitle: { maxWidth: 480, fontFamily: font.body, fontSize: fontSize.base, lineHeight: lineHeight.base, color: color.inkMuted },

  sectionLabel: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.inkFaint },

  fieldLabel: { fontFamily: font.bodySemi, fontSize: fontSize.base, color: color.ink },
  fieldLabelOptional: { fontFamily: font.body, color: color.inkFaint },
  fieldCaption: { marginTop: space.xs, fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  errorText: { marginTop: space.xs, fontFamily: font.body, fontSize: fontSize.sm, color: color.danger },
  addDocRow: { flexDirection: 'row', gap: space.sm, marginTop: space.sm, alignItems: 'center' },

  formDivider: { height: 1, backgroundColor: color.borderFaint },

  input: { marginTop: space.xs, backgroundColor: color.canvas, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.sm, fontFamily: font.body, fontSize: fontSize.base, color: color.ink },
  inputError: { borderColor: color.dangerBorder },
  textareaLarge: { marginTop: space.xs, minHeight: 150, backgroundColor: color.canvas, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.sm, fontFamily: font.body, fontSize: fontSize.base, lineHeight: lineHeight.base, color: color.ink, textAlignVertical: 'top' },
  mono: { fontFamily: font.monoMedium },

  twoColRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
  twoCol: { flexGrow: 1, flexBasis: 200, minWidth: 180 },

  budgetRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs },
  budgetField: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.xs, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.sm },
  budgetCurrency: { fontFamily: font.mono, fontSize: fontSize.sm, color: color.inkFaint },
  budgetInput: { flex: 1, minWidth: 0, fontFamily: font.monoMedium, fontSize: fontSize.sm, color: color.ink },
  budgetSep: { color: color.inkFaint },

  dateRangeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap', marginTop: space.xs },
  toLabel: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkFaint },
  dateField: { flex: 1, minWidth: 140, marginTop: 0, justifyContent: 'center' },
  dateFieldText: { fontFamily: font.monoMedium, fontSize: fontSize.base, color: color.ink },
  dateFieldPlaceholder: { fontFamily: font.body, color: color.inkFaint },

  pillGroupWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.sm },
  pill: { borderWidth: 1, borderColor: color.border, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.xs + 2 },
  pillActive: { backgroundColor: color.primaryFaint, borderColor: color.primary },
  pillLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.inkMuted },
  pillLabelActive: { color: color.primary },

  fileChip: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.xs, maxWidth: 220 },
  fileChipName: { flexShrink: 1, fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.ink },
  addDashed: { alignSelf: 'flex-start', borderWidth: 1, borderStyle: 'dashed', borderColor: color.border, borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: space.sm },
  addDashedLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.inkMuted },

  // Unlike every other field row in this form (twoColRow, dateRangeRow,
  // budgetRow), this one has no flexWrap and its two inputs' minWidths used to
  // add up to 280 before the remove button and gaps even joined in — 324px
  // total, more than the ~280–335px actually available on a real phone (after
  // the 20px screen padding on each side), so it clipped/overflowed on
  // virtually every device. Text inputs scroll their own content internally,
  // so shrinking the floor here (rather than adding wrap, which would risk
  // orphaning the remove button on its own line) keeps this a predictable
  // single row down to a 320px-wide screen.
  specEditRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  specEditLabelInput: { flex: 1, minWidth: 90, marginTop: 0 },
  specEditValueInput: { flex: 2, minWidth: 120, marginTop: 0 },
  specEditRemove: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },

  xGlyph: { width: 12, height: 12, alignItems: 'center', justifyContent: 'center' },
  xGlyphBar: { position: 'absolute', width: 10, height: 1.4, borderRadius: 1 },
  checkGlyph: { width: 9, height: 5, marginTop: -2, borderLeftWidth: 2, borderBottomWidth: 2, borderColor: color.onPrimary, transform: [{ rotate: '-45deg' }] },

  actionButton: { minHeight: layout.minTouchTarget, borderRadius: radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },
  actionButtonLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm },

  summaryBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, borderWidth: 1, borderColor: color.dangerBorder, borderRadius: radius.lg, backgroundColor: color.surface, padding: space.sm },
  summaryDot: { width: 7, height: 7, borderRadius: radius.pill, backgroundColor: color.danger, marginTop: 5 },
  summaryText: { flex: 1, fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },

  /* closing — the highest-weight field on the whole flow, its own step for emphasis */
  closingCard: { ...elevation.cardRaised, borderRadius: radius.xl, backgroundColor: color.surface, padding: space.lg, gap: space.md, borderLeftWidth: 3, borderLeftColor: color.primary },
  closingLockNote: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  closingStampRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg, flexWrap: 'wrap', paddingTop: space.md, borderTopWidth: 1, borderTopColor: color.borderFaint },
  closingStampDivider: { width: 1, height: 32, backgroundColor: color.border },
  closingStampValue: { marginTop: space.xs, fontFamily: font.display, fontSize: fontSize.md, letterSpacing: letterSpacing.tight, color: color.ink },
  closingNote: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm },

  /* review summary */
  summaryLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space.md, flexWrap: 'wrap' },
  summaryLineLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.inkMuted },
  summaryLineValue: { flexShrink: 1, textAlign: 'right', fontFamily: font.body, fontSize: fontSize.sm, color: color.ink },
  summaryBlockValue: { marginTop: 2, fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.ink },

  sealedCard: { borderWidth: 1, borderColor: color.primaryBorder, borderLeftWidth: 3, borderLeftColor: color.primary, borderRadius: radius.xl, backgroundColor: color.primaryFaint, padding: space.lg, gap: space.xs },
  sealedHeading: { fontFamily: font.display, fontSize: fontSize.md, letterSpacing: letterSpacing.tight, color: color.ink },
  sealedBody: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },

  /* before you publish */
  beforePublishCard: { borderWidth: 1, borderColor: color.dangerBorder, borderLeftWidth: 3, borderLeftColor: color.danger, borderRadius: radius.xl, backgroundColor: color.surface, padding: space.lg },
  beforePublishHeading: { marginTop: space.md, fontFamily: font.display, fontSize: fontSize.lg, lineHeight: lineHeight.lg, letterSpacing: letterSpacing.tight, color: color.ink, maxWidth: 460 },
  lockRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  // A solid dot, not an outlined box — an outlined square here reads as an
  // unchecked checkbox (it used to be exactly that shape, just smaller than
  // the real one below), which had a business tapping each one expecting
  // them to toggle before the real acknowledgment checkbox would respond.
  // These four are read-only context; only the checkbox below is real.
  lockIcon: { width: 8, height: 8, marginTop: 7, borderRadius: radius.pill, backgroundColor: color.danger },
  lockName: { fontFamily: font.bodySemi, fontSize: fontSize.base, color: color.ink },
  lockBody: { marginTop: 2, fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },

  ackRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, marginTop: space.lg, paddingTop: space.md, borderTopWidth: 1, borderTopColor: color.borderFaint },
  checkbox: { width: 18, height: 18, marginTop: 2, borderWidth: 1.4, borderColor: color.border, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: color.primary, borderColor: color.primary },
  ackText: { flex: 1, fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  ackBold: { fontFamily: font.bodySemi, color: color.ink },
});
