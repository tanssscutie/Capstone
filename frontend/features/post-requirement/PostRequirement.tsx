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

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import type { TextInputProps, ViewStyle } from 'react-native';
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
import {
  OTHER_ITEM_CODE, PREFERRED_BRAND_ID, QUANTITY_ATTRIBUTE_IDS, SUPPLIER_TO_RECOMMEND, findItem, isNumber, itemSpecError, itemsFor,
  specDisplayValue, specLabel, splitQuantity, useCategoryTree,
} from '../../lib/data/categories';
import { suggestAttribute } from '../../lib/api/meta';
import type { CategoryItem, SpecTemplate } from '../../lib/data/categories';
import { NCR_CITIES } from '../../lib/data/philippines';
import { isWebFilePickerSupported, pickWebFile } from '../../lib/pickWebFile';
import { VALIDATION_ERROR_MARK, scrollToFirstError } from '../../lib/scrollToFirstError';
import { barangayLabel, foldName, useNcrAddresses } from '../../lib/data/ncrAddresses';
import { useMarketRules } from '../../lib/data/marketRules';
import { CaptionOrHint, InfoHint } from '../../components/ui/InfoHint';
import type { DetailDraftInput, DetailDraftOut } from '../../lib/api/requirements';

/* ─── Draft shapes ───────────────────────────────────────
 * One draft per step, assembled into a real `Requirement` by the route only once REVIEW
 * publishes — the same shape Onboarding's IdentityDraft/OperationsDraft/DocumentsDraft are
 * assembled into a `Business` only once DOCUMENTS submits. */

export interface RequirementDetailsDraft {
  category: string;
  /** One of the category's items (GET /meta/categories), "other" for free-form.
   *  Picking one pre-fills the item's spec template as fixed-label rows. */
  itemCode: string;
  title: string;
  scope: string;
  specifications: SpecRow[];
  quantity: string;
  budgetMin: number | null;
  budgetMax: number | null;
  /** Quotations above budgetMax are refused (off = indicative). */
  strictBudget?: boolean;
  requiredDocuments: string[];
  /** Reference files (optional) — a floor plan, product photo or sample design. */
  attachments?: Attachment[];
}

export interface RequirementDeliveryDraft {
  city: string;
  /** Street / building / unit number. */
  address: string;
  /** PSGC barangay name; optional only so an older clone still loads. */
  barangay?: string;
  zipCode?: string;
  windowFrom: string; // "YYYY-MM-DD"
  windowTo: string;   // "YYYY-MM-DD"
}

export interface RequirementClosingDraft {
  closeDate: string; // "YYYY-MM-DD"
  closeTime: string; // one of TIME_OPTIONS' values
}

/** The three step drafts combined into what the route needs to assemble a `Requirement`. */
export interface RequirementDraftInput {
  category: string;
  itemCode: string;
  title: string;
  scope: string;
  specifications: SpecRow[];
  quantity: string;
  budgetMin: number | null;
  budgetMax: number | null;
  strictBudget?: boolean;
  requiredDocuments: string[];
  deliveryCity: string;
  deliveryAddress: string;
  deliveryBarangay: string;
  deliveryZip: string;
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
  /** "Write with AI" — a Detail text from Step 1 (POST /requirements/detail-draft).
   *  Nothing is saved; the button is hidden when this isn't wired. */
  onDraftDetail?: (input: DetailDraftInput) => Promise<DetailDraftOut>;
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
/** Digits in the quantity field — up to 9,999,999. Mirrors the backend's
 *  RequirementCreate._check_quantity. */
const QUANTITY_DIGITS_MAX = 7;
const SPEC_LABEL_MIN = 2;
const SPEC_LABEL_MAX = 100;
const SPEC_VALUE_MIN = 2;
const SPEC_VALUE_MAX = 200;
const SITE_ADDRESS_MAX = 200;
/** "Other" items keep their name as a spec row with this label — no new field. */
const OTHER_ITEM_LABEL = 'Item';
/** A GridPicker shows a search box once it has more options than one 3×3 page. */
const GRID_SEARCH_AFTER = 9;
/** Barangay matches listed under the search field at once. */
const BARANGAY_MATCHES_SHOWN = 8;
/** Searching all of Metro Manila (no city yet) — enough to scroll through, not 1,700 rows. */
const BARANGAY_SEARCH_MAX = 60;

/** One example label/value pair per category, shown as the Specifications
 *  row's placeholder text once a category is picked — before that, the
 *  Printing example. Purely
 *  illustrative: never prefilled into the actual fields, and picking a
 *  different category doesn't touch specs the buyer already typed. */
const SPEC_EXAMPLE_BY_CATEGORY: Record<string, { label: string; value: string }> = {
  'Printing': { label: 'e.g. Paper size and stock', value: 'e.g. A4, 80gsm bond paper' },
  'Packaging & Labeling': { label: 'e.g. Box dimensions', value: 'e.g. 30 cm × 20 cm × 15 cm, corrugated' },
};
const DEFAULT_SPEC_EXAMPLE = SPEC_EXAMPLE_BY_CATEGORY['Printing'];

/** "Design file" (the category layer's artwork attribute): picking this one
 *  offers the file upload right there, into Reference files. */
const DESIGN_FILE_ID = 'artwork';
const DESIGN_FILE_READY = 'Print-ready file provided';
const DESIGN_FILE_LABEL = 'Design file';

/** What a "See example" shows: the field as it looks filled in, plus one tip. */
interface FieldExample {
  value: string;
  kind?: 'input' | 'textarea' | 'pills' | 'select';
  /** Pills: the choices shown, `value` being the picked one. */
  options?: string[];
  suffix?: string;
  tip: string;
}

/** Sample values for spec rows, by attribute id (and unit for sizes). Select
 *  specs need none — their example is the first real choice. */
const SPEC_EXAMPLE_VALUES: Record<string, string> = {
  size: '3 x 6',
  'size:in': '2 x 3.5',
  'size:cm': '30 x 20 x 15',
  'size:mm': '60 x 150',
  color: 'Navy blue',
  paper_weight: '120',
  page_count: '24',
  cover_paper: '250gsm C2S, matte',
  inside_paper: '100gsm book paper',
  sizes_breakdown: 'S 10, M 20, L 15, XL 5',
  print_locations: 'Front chest logo, full back print',
  fill_capacity: '250 g coffee beans',
  thickness: '50',
  container: '500 ml round PET bottle',
  preferred_brand: '3M',
  remarks: 'Deliver in two batches, half by the 15th',
};

const SPEC_EXAMPLE_TIPS: Record<string, string> = {
  artwork: 'Print-ready: you already have the final file — attach it here. Needs layout: the supplier designs it (usually priced extra).',
  size: 'Width x height in the unit shown. Suppliers price the material by it.',
  sizes_breakdown: 'How many of each size, so suppliers order the right blanks.',
  preferred_brand: 'Suppliers see it as "or equivalent" — it never limits who can respond.',
};

function specExample(spec: SpecTemplate): FieldExample {
  const tip = SPEC_EXAMPLE_TIPS[spec.id]
    ?? (spec.can_recommend
      ? 'Not sure? Tap "Not sure — supplier to recommend" and suppliers will suggest one.'
      : 'Suppliers price against exactly what you put here.');
  if (spec.type === 'select') {
    const picked = spec.options.find((o) => o !== 'None' && o !== 'No') ?? spec.options[0] ?? '';
    return { kind: 'pills', options: spec.options, value: picked, tip };
  }
  const value = SPEC_EXAMPLE_VALUES[`${spec.id}:${spec.unit}`] ?? SPEC_EXAMPLE_VALUES[spec.id] ?? 'e.g. as specific as you can';
  return { kind: 'input', value, suffix: spec.unit ?? undefined, tip };
}

const FIELD_EXAMPLES: Record<string, Record<string, FieldExample>> = {
  Printing: {
    item: { kind: 'select', value: 'Tarpaulin', tip: 'Pick the closest item — what suppliers need to know appears below. Not listed? Choose Other.' },
    title: { value: 'Tarpaulins for our Pasig store opening', tip: 'One line: what you need, and what it is for.' },
    detail: {
      kind: 'textarea',
      value: 'Two tarpaulins for the store front and the entrance, up for about a month outdoors. We have the final design (attached). Please include delivery to the store and say if you recommend a thicker material.',
      tip: 'What it is for, anything it must have, and what suppliers should include in their price.',
    },
  },
  'Packaging & Labeling': {
    item: { kind: 'select', value: 'Corrugated boxes', tip: 'Pick the closest item — what suppliers need to know appears below. Not listed? Choose Other.' },
    title: { value: 'Shipping boxes for our online orders', tip: 'One line: what you need, and what it is for.' },
    detail: {
      kind: 'textarea',
      value: 'Printed shipping boxes for small appliances, about 2 kg each. Logo on two sides, one color. Please include delivery to our Caloocan warehouse and the lead time for repeat orders.',
      tip: 'What it is for, anything it must have, and what suppliers should include in their price.',
    },
  },
};
const COMMON_EXAMPLES: Record<string, FieldExample> = {
  otherItem: { value: 'Acrylic keychains', tip: 'Name it the way a supplier would search for it.' },
  quantity: { value: '500', suffix: 'pcs', tip: 'Count what you will receive. Boxes, packs or rolls? Say how many pieces are in each.' },
  budget: { value: '₱5,000  –  ₱20,000', tip: 'A realistic range helps suppliers price. It is not a promise to pay the maximum.' },
  customSpec: { value: 'Size  ·  2 x 3 in', tip: 'Anything else suppliers should know: write what it is on the left and the detail on the right.' },
  documents: { kind: 'pills', options: ['DENR Permit', 'Sample of a similar job'], value: 'DENR Permit', tip: 'Only what this job needs — registration papers are already verified by TrustLink.' },
  files: { value: 'store-front-tarpaulin-final.pdf', tip: 'A floor plan, product photo or sample design. Every business browsing this requirement can open it.' },
};

function fieldExample(category: string, key: string): FieldExample | undefined {
  return (FIELD_EXAMPLES[category] ?? FIELD_EXAMPLES['Printing'])[key] ?? COMMON_EXAMPLES[key];
}

/** Typical qualifying documents per category — a starting suggestion for
 *  the (optional, per the study's own Scope and Delimitation) Required
 *  documents field, not a mandate. Shown only as tappable "Suggested" chips —
 *  nothing is added to the field until the buyer picks one, same convention
 *  as every other suggestion feature in this app. */
const REQUIRED_DOCS_BY_CATEGORY: Record<string, string[]> = {
  'Printing': ['DENR Permit'],
  'Packaging & Labeling': ['DENR Permit', 'FDA License to Operate'],
};

/** Same convention as SPEC_EXAMPLE_BY_CATEGORY, extended to Title, Scope,
 *  and Quantity — placeholder text only, never prefilled into the actual
 *  fields, and switching category never touches anything already typed. */
const DETAILS_EXAMPLE_BY_CATEGORY: Record<string, { title: string; scope: string; quantity: string }> = {
  'Printing': {
    title: 'e.g. Bulk printing of tarpaulins for a company event',
    scope: 'e.g. Full-color tarpaulin printing, weatherproof, with grommets every 50cm.',
    quantity: 'e.g. 20',
  },
  'Packaging & Labeling': {
    title: 'e.g. Custom corrugated boxes for product shipping',
    scope: 'e.g. Printed corrugated boxes, double-wall, sized for a specific product line.',
    quantity: 'e.g. 5,000',
  },
};
const DEFAULT_DETAILS_EXAMPLE = DETAILS_EXAMPLE_BY_CATEGORY['Printing'];

/** One-line description under each category card in DETAILS. */
const CATEGORY_BLURBS: Record<string, string> = {
  'Printing': 'Offset, digital and large-format print, signage, bookbinding',
  'Packaging & Labeling': 'Boxes, labels and stickers, wraps and custom packaging',
};

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
  { name: 'Detail and specifications', body: 'Respondents price against exactly what you posted — changing it after publish would invalidate quotations already sealed against it.' },
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

/** Digits only — a requirement's quantity is a count of pcs / sets / boxes /
 *  packs / rolls / reams / sheets, never a fraction. Letters, symbols, commas,
 *  spaces and decimal points never make it into the field, whatever the
 *  keyboard (a desktop browser ignores keyboardType entirely). */
function sanitizeWholeNumber(v: string): string {
  return v.replace(/[^0-9]/g, '');
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

/** Today's date in Philippine time ("YYYY-MM-DD") — the same clock the backend
 *  judges "already past" by (app/core/clock.py), whatever timezone the device is in. */
function todayPHDateString(): string {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
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
    itemCode: details.itemCode,
    title: details.title,
    scope: details.scope,
    specifications: details.specifications,
    quantity: details.quantity,
    budgetMin: details.budgetMin,
    budgetMax: details.budgetMax,
    strictBudget: details.strictBudget ?? false,
    requiredDocuments: details.requiredDocuments,
    deliveryCity: delivery.city,
    deliveryAddress: delivery.address,
    deliveryBarangay: delivery.barangay ?? '',
    deliveryZip: delivery.zipCode ?? '',
    deliveryWindowFrom: delivery.windowFrom,
    deliveryWindowTo: delivery.windowTo,
    attachments: details.attachments ?? [],
    closingAt: buildClosingISO(closing.closeDate, closing.closeTime),
  };
}

/* ─── Small building blocks ─────────────────────────── */

/** RN-web passes these straight through as CSS; native ignores them. */
function webTransition(properties: string): ViewStyle {
  return Platform.OS === 'web'
    ? ({ transitionProperty: properties, transitionDuration: '160ms', transitionTimingFunction: 'ease-out' } as unknown as ViewStyle)
    : {};
}

/** Hover is web-only; on native the handlers are simply not attached. */
function useHover() {
  const [hovered, setHovered] = useState(false);
  const handlers =
    Platform.OS === 'web' ? { onHoverIn: () => setHovered(true), onHoverOut: () => setHovered(false) } : {};
  return [hovered, handlers] as const;
}

/** TextInput that lights its border (plus a soft ring on web) while focused. */
function FormInput({ style, onFocus, onBlur, ...props }: TextInputProps) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      {...props}
      placeholderTextColor={color.inkFaint}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      style={[style, webTransition('border-color, background-color, box-shadow'), focused && styles.inputFocused]}
    />
  );
}

/** One white card per group of fields: numbered badge, title, optional caption. */
function SectionCard({
  index,
  title,
  caption,
  optional,
  example,
  children,
}: {
  index?: number;
  title: string;
  caption?: string;
  optional?: boolean;
  /** "See example" in the header — the card's main field, filled in. */
  example?: FieldExample;
  children: ReactNode;
}) {
  const { width } = useWindowDimensions();
  const [exampleOpen, setExampleOpen] = useState(false);
  return (
    <View style={[styles.sectionCard, width < 480 && styles.sectionCardCompact]}>
      <View style={styles.sectionCardHeader}>
        {index != null && (
          <View style={styles.sectionBadge}>
            <Text style={styles.sectionBadgeLabel}>{index}</Text>
          </View>
        )}
        <Text style={styles.sectionCardTitle}>{title}</Text>
        {optional && (
          <View style={styles.optionalTag}>
            <Text style={styles.optionalTagLabel}>Optional</Text>
          </View>
        )}
        {!!example && <View style={{ flex: 1 }} />}
        {!!example && <ExampleLink open={exampleOpen} onPress={() => setExampleOpen((v) => !v)} />}
      </View>
      {!!caption && <CaptionOrHint text={caption} style={styles.sectionCardCaption} />}
      {!!example && exampleOpen && <ExampleShot label={title} example={example} />}
      <View style={styles.sectionCardBody}>{children}</View>
    </View>
  );
}

/** The two categories as selectable cards — bigger targets than pills, with a blurb. */
function CategoryCard({ label, blurb, active, onPress }: { label: string; blurb?: string; active: boolean; onPress: () => void }) {
  const [hovered, hoverHandlers] = useHover();
  return (
    <Pressable
      {...hoverHandlers}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      style={({ pressed }) => [
        styles.categoryCard,
        webTransition('border-color, background-color, transform'),
        hovered && !active && styles.categoryCardHovered,
        active && styles.categoryCardActive,
        pressed && styles.pressedScale,
      ]}
    >
      <View style={styles.categoryCardTop}>
        <Text style={[styles.categoryCardTitle, active && styles.categoryCardTitleActive]}>{label}</Text>
        <View style={[styles.radioDot, active && styles.radioDotOn]}>{active && <View style={styles.radioDotInner} />}</View>
      </View>
      {!!blurb && <Text style={styles.categoryCardBlurb}>{blurb}</Text>}
    </Pressable>
  );
}

function SectionLabel({ children, tone }: { children: string; tone?: string }) {
  return <Text style={[styles.sectionLabel, tone ? { color: tone } : null]}>{children}</Text>;
}

function Pill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const [hovered, hoverHandlers] = useHover();
  return (
    <Pressable
      {...hoverHandlers}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        webTransition('border-color, background-color, transform'),
        hovered && !active && styles.pillHovered,
        active ? styles.pillActive : null,
        pressed && styles.pressedScale,
      ]}
    >
      <Text style={[styles.pillLabel, active ? styles.pillLabelActive : null]}>{label}</Text>
    </Pressable>
  );
}

/** Down/up caret built from two borders of a rotated square. */
function CaretGlyph({ open }: { open: boolean }) {
  return <View style={[styles.caretGlyph, { transform: [{ rotate: open ? '-135deg' : '45deg' }] }]} />;
}

/** Small four-point mark for the AI button — two rotated squares. */
function SparkGlyph() {
  return (
    <View style={styles.sparkGlyph}>
      <View style={styles.sparkGlyphBar} />
      <View style={[styles.sparkGlyphBar, { transform: [{ rotate: '45deg' }] }]} />
    </View>
  );
}

interface GridOption {
  value: string;
  label: string;
  /** A second, quieter line on the tile. */
  meta?: string;
}

function GridTile({ option, active, onPress }: { option: GridOption; active: boolean; onPress: () => void }) {
  const [hovered, hoverHandlers] = useHover();
  return (
    <Pressable
      {...hoverHandlers}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      style={({ pressed }) => [
        styles.gridTile,
        webTransition('border-color, background-color, transform'),
        hovered && !active && styles.gridTileHovered,
        active && styles.gridTileActive,
        pressed && styles.pressedScale,
      ]}
    >
      <Text style={[styles.gridTileLabel, active && styles.gridTileLabelActive]} numberOfLines={2}>{option.label}</Text>
      {!!option.meta && <Text style={styles.gridTileMeta} numberOfLines={1}>{option.meta}</Text>}
    </Pressable>
  );
}

/** A select field that opens a 3×3 grid of tiles (about three rows tall, then it
 *  scrolls), with a search box when there are more than nine options. Used for
 *  the item and, on Delivery, the city. */
function GridPicker({
  value,
  options,
  placeholder,
  searchPlaceholder = 'Search',
  invalid,
  onChange,
}: {
  value: string;
  options: GridOption[];
  placeholder: string;
  searchPlaceholder?: string;
  invalid?: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hovered, hoverHandlers] = useHover();
  const selected = options.find((o) => o.value === value);
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  return (
    <View>
      <Pressable
        {...hoverHandlers}
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={[
          styles.selectField,
          webTransition('border-color, background-color, box-shadow'),
          hovered && !open && styles.selectFieldHovered,
          open && styles.inputFocused,
          invalid ? styles.inputError : null,
        ]}
      >
        <Text style={[styles.selectValue, !selected && styles.selectPlaceholder]} numberOfLines={1}>
          {selected?.label ?? placeholder}
        </Text>
        <CaretGlyph open={open} />
      </Pressable>
      {open && (
        <View style={styles.gridPanel}>
          {options.length > GRID_SEARCH_AFTER && (
            <FormInput value={query} onChangeText={setQuery} placeholder={searchPlaceholder} style={[styles.input, { marginTop: 0 }]} />
          )}
          <ScrollView style={styles.gridScroll} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            <View style={styles.gridTiles}>
              {shown.map((o) => (
                <GridTile
                  key={o.value}
                  option={o}
                  active={o.value === value}
                  onPress={() => {
                    onChange(o.value);
                    setOpen(false);
                    setQuery('');
                  }}
                />
              ))}
            </View>
            {shown.length === 0 && <Text style={styles.optionEmpty}>Nothing matches "{query.trim()}".</Text>}
          </ScrollView>
        </View>
      )}
    </View>
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
  const [hovered, hoverHandlers] = useHover();
  return (
    <Pressable
      {...hoverHandlers}
      onPress={onPress}
      style={[styles.addDashed, webTransition('border-color, background-color'), hovered && styles.addDashedHovered]}
    >
      <Text style={[styles.addDashedLabel, hovered && styles.addDashedLabelHovered]}>+ {label}</Text>
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
  min,
}: {
  value: string;
  onPick: (value: string) => void;
  placeholder: string;
  error?: boolean;
  /** "YYYY-MM-DD" — earliest pickable day in the browser's calendar. A typed-in
   *  earlier date still gets through the input itself, so callers validate too. */
  min?: string;
}) {
  const webAvailable = typeof document !== 'undefined' && typeof document.createElement === 'function';
  const [focused, setFocused] = useState(false);

  if (webAvailable) {
    return (
      <input
        type="date"
        value={value}
        min={min}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onPick(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          flex: 1,
          minWidth: 140,
          marginTop: 0,
          fontFamily: font.monoMedium,
          fontSize: fontSize.base,
          color: color.ink,
          background: color.canvas,
          border: `1px solid ${error ? color.dangerBorder : focused ? color.primary : color.border}`,
          boxShadow: focused ? `0 0 0 3px ${color.primaryFaint}` : 'none',
          transition: 'border-color 160ms ease-out, box-shadow 160ms ease-out',
          borderRadius: radius.md,
          minHeight: layout.minTouchTarget,
          boxSizing: 'border-box',
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
  /** Dictionary attribute id — every template row has one; a custom row gets
   *  one only when the buyer accepts a "Did you mean …?" suggestion. */
  attributeId?: string | null;
  /** Set on rows that come from the item's merged specs — label fixed, can't be removed. */
  template?: SpecTemplate;
  /** Custom rows only: the attribute the label probably means. Advisory. */
  suggestion?: { attributeId: string; label: string; unit: string | null } | null;
  /** The label the buyer said "Hindi" to — not asked again until it changes. */
  suggestionDismissedFor?: string;
}

/** The item's spec rows first (quantity/unit excluded — they're the Quantity
 *  field), then the buyer's own rows. A custom row with the same attribute id
 *  or label as a spec (a cloned requirement's rows) hands its value to that
 *  spec's row instead of staying a duplicate. Spec rows of a previously picked
 *  item are dropped — their values don't carry over. */
function withTemplate(rows: SpecRowDraft[], item: CategoryItem | undefined): SpecRowDraft[] {
  const custom = rows.filter((r) => !r.template);
  const taken = new Set<string>();
  const templateRows: SpecRowDraft[] = (item?.specs ?? [])
    .filter((spec) => !QUANTITY_ATTRIBUTE_IDS.includes(spec.id))
    .map((spec) => {
      const label = specLabel(spec);
      const source = custom.find((r) => (r.attributeId && r.attributeId === spec.id) || r.label.trim() === label);
      if (source) taken.add(source.id);
      return { id: `tpl-${item!.code}-${spec.id}`, label, value: source?.value ?? '', attributeId: spec.id, template: spec };
    });
  return [...templateRows, ...custom.filter((r) => !taken.has(r.id))];
}

/** A template row: fixed label, value typed in — or picked, for a select spec. */
function TemplateSpecRow({
  row,
  missing,
  onChangeValue,
  children,
}: {
  row: SpecRowDraft;
  missing: boolean;
  onChangeValue: (v: string) => void;
  /** Extra content under the field — the Design file upload. */
  children?: ReactNode;
}) {
  const spec = row.template!;
  const recommended = spec.can_recommend && row.value === SUPPLIER_TO_RECOMMEND;
  return (
    <View>
      <FieldHeader label={spec.label} optional={!spec.required} example={specExample(spec)} />
      {spec.id === PREFERRED_BRAND_ID && (
        <Text style={styles.fieldCaption}>Respondents see it as "or equivalent" — it never limits who can respond.</Text>
      )}
      {spec.type === 'select' ? (
        <View style={styles.pillGroupWrap}>
          {spec.options.map((o) => (
            <Pill key={o} label={o} active={row.value === o} onPress={() => onChangeValue(row.value === o ? '' : o)} />
          ))}
        </View>
      ) : (
        <View style={styles.unitInputRow}>
          <FormInput
            value={recommended ? '' : row.value}
            onChangeText={onChangeValue}
            maxLength={SPEC_VALUE_MAX}
            keyboardType={spec.type === 'number' ? 'decimal-pad' : 'default'}
            placeholder={recommended ? 'Supplier will recommend' : spec.type === 'number' ? 'Number' : 'Type it here'}
            style={[styles.input, { flex: 1 }, missing ? styles.inputError : null]}
          />
          {!!spec.unit && <Text style={styles.unitSuffix}>{spec.unit}</Text>}
        </View>
      )}
      {spec.can_recommend && (
        <View style={styles.pillGroupWrap}>
          <Pill
            label="Not sure — supplier to recommend"
            active={recommended}
            onPress={() => onChangeValue(recommended ? '' : SUPPLIER_TO_RECOMMEND)}
          />
        </View>
      )}
      {missing && <Text style={styles.errorText} {...VALIDATION_ERROR_MARK}>{spec.can_recommend ? 'Add it, or tap "Not sure".' : spec.type === 'select' ? 'Pick one.' : 'Add a value.'}</Text>}
      {children}
    </View>
  );
}

function SpecificationEditRow({
  row,
  invalid,
  partial,
  labelPlaceholder,
  valuePlaceholder,
  onChangeLabel,
  onChangeValue,
  onRemove,
  onBlurLabel,
  onAcceptSuggestion,
  onDismissSuggestion,
}: {
  row: SpecRowDraft;
  invalid?: boolean;
  /** Only one of label/value filled in. */
  partial?: boolean;
  labelPlaceholder?: string;
  valuePlaceholder?: string;
  onChangeLabel: (v: string) => void;
  onChangeValue: (v: string) => void;
  onRemove: () => void;
  onBlurLabel: () => void;
  onAcceptSuggestion: () => void;
  onDismissSuggestion: () => void;
}) {
  return (
    <View>
      <View style={styles.specEditRow}>
        <FormInput
          value={row.label}
          onChangeText={onChangeLabel}
          onBlur={onBlurLabel}
          maxLength={SPEC_LABEL_MAX}
          placeholder={labelPlaceholder ?? DEFAULT_SPEC_EXAMPLE.label}
          style={[styles.input, styles.specEditLabelInput, invalid || (partial && !row.label.trim()) ? styles.inputError : null]}
        />
        <FormInput
          value={row.value}
          onChangeText={onChangeValue}
          maxLength={SPEC_VALUE_MAX}
          placeholder={valuePlaceholder ?? DEFAULT_SPEC_EXAMPLE.value}
          style={[styles.input, styles.specEditValueInput, invalid || (partial && !row.value.trim()) ? styles.inputError : null]}
        />
        <Pressable onPress={onRemove} style={styles.specEditRemove} hitSlop={8}>
          <XGlyph tone={color.inkFaint} />
        </Pressable>
      </View>
      {!!row.suggestion && (
        <View style={styles.specSuggestionRow}>
          <Text style={styles.fieldCaption}>
            Did you mean <Text style={styles.ackBold}>{specLabel(row.suggestion)}</Text>?
          </Text>
          <Pressable onPress={onAcceptSuggestion} style={[styles.suggestionChip, { marginTop: 0 }]} accessibilityRole="button">
            <Text style={styles.suggestionChipText}>Yes, use it</Text>
          </Pressable>
          <Pressable onPress={onDismissSuggestion} hitSlop={6} accessibilityRole="button">
            <Text style={styles.fieldCaption}>No</Text>
          </Pressable>
        </View>
      )}
      {partial && (
        <Text style={styles.errorText} {...VALIDATION_ERROR_MARK}>{row.label.trim() ? 'Add a value for this specification.' : 'Add a label for this value.'}</Text>
      )}
      {invalid && (
        <Text style={styles.errorText} {...VALIDATION_ERROR_MARK}>
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
  const [hovered, hoverHandlers] = useHover();
  const live = hovered && !disabled;
  return (
    <Pressable
      {...hoverHandlers}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.actionButton,
        webTransition('background-color, border-color, transform, box-shadow, opacity'),
        {
          backgroundColor:
            variant === 'primary'
              ? pressed || live ? color.primaryPressed : color.primary
              : variant === 'text' ? 'transparent' : live ? color.surfaceSunken : color.surface,
          borderColor: variant === 'outline' ? (live ? color.borderStrong : color.border) : variant === 'text' ? 'transparent' : color.primary,
          opacity: disabled ? 0.5 : 1,
        },
        variant === 'primary' && live && styles.actionButtonPrimaryHovered,
        pressed && !disabled && styles.pressedScale,
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

function ExampleLink({ open, onPress }: { open: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} accessibilityRole="button" accessibilityState={{ expanded: open }}>
      <Text style={styles.exampleLink}>{open ? 'Hide example' : 'See example'}</Text>
    </Pressable>
  );
}

/** A "screenshot" of a field filled in with sample data — drawn with the same
 *  shapes as the real field, so it follows light and dark mode. Never editable. */
function ExampleShot({ label, example }: { label: string; example: FieldExample }) {
  const kind = example.kind ?? 'input';
  return (
    <View style={styles.exampleShot} accessibilityLabel={`Example for ${label}: ${example.value}`}>
      <Text style={styles.exampleEyebrow}>EXAMPLE</Text>
      <Text style={styles.exampleLabel}>{label}</Text>
      {kind === 'pills' ? (
        <View style={styles.pillGroupWrap}>
          {(example.options ?? []).map((o) => (
            <View key={o} style={[styles.pill, o === example.value ? styles.pillActive : null]}>
              <Text style={[styles.pillLabel, o === example.value ? styles.pillLabelActive : null]}>{o}</Text>
            </View>
          ))}
        </View>
      ) : (
        <View style={[styles.exampleField, kind === 'textarea' && styles.exampleFieldTall]}>
          <Text style={styles.exampleValue}>{example.value}</Text>
          {!!example.suffix && <Text style={styles.unitSuffix}>{example.suffix}</Text>}
          {kind === 'select' && <CaretGlyph open={false} />}
        </View>
      )}
      <Text style={styles.exampleTip}>{example.tip}</Text>
    </View>
  );
}

/** A field's label with its "See example" link (and any action, e.g. Write with
 *  AI) on the right; the example opens right under the label. */
function FieldHeader({ label, optional, example, action }: { label: string; optional?: boolean; example?: FieldExample; action?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <View style={styles.labelRow}>
        <FieldLabel optional={optional}>{label}</FieldLabel>
        <View style={styles.labelActions}>
          {!!example && <ExampleLink open={open} onPress={() => setOpen((v) => !v)} />}
          {action}
        </View>
      </View>
      {open && !!example && <ExampleShot label={label} example={example} />}
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

function ScreenTitle({ step, title, subtitle }: { step: PostRequirementState; title: string; subtitle: string }) {
  const index = STEP_ORDER.indexOf(step);
  return (
    <View style={styles.hero}>
      <Text style={styles.heroEyebrow}>
        Step {index + 1} of {STEP_ORDER.length} · {STEP_LABELS[step]}
      </Text>
      <Text style={styles.pageTitle}>{title}</Text>
      <CaptionOrHint text={subtitle} style={styles.pageSubtitle} />
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
            <View style={{ alignSelf: 'flex-start' }}>
              <ActionButton label={`← ${leftLabel}`} variant="outline" onPress={onLeft} />
            </View>
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

function DetailsScreen({ poster, initial, onContinue, reportContinue, onSuggestCategory, onDraftDetail }: DetailsProps & { reportContinue: (fn: () => void) => void }) {
  const { tree, categories, error: treeError } = useCategoryTree();
  const [category, setCategory] = useState(initial?.category ?? '');
  const [itemCode, setItemCode] = useState(initial?.itemCode ?? '');
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
  // "Other": what the item is, kept as the spec row labelled OTHER_ITEM_LABEL.
  const initialOtherRow = initial?.itemCode === OTHER_ITEM_CODE
    ? (initial?.specifications ?? []).find((s) => s.label.trim() === OTHER_ITEM_LABEL)
    : undefined;
  const [otherItem, setOtherItem] = useState(initialOtherRow?.value ?? '');
  const [specRows, setSpecRows] = useState<SpecRowDraft[]>(
    () => (initial?.specifications ?? [])
      .filter((s) => s !== initialOtherRow)
      .map((s, i) => ({ id: `spec-init-${i}`, label: s.label, value: s.value, attributeId: s.attributeId ?? null })),
  );
  // A cloned requirement's specs arrive as plain rows, and the tree may still be
  // loading on first render — lay the item's template over them once it's here.
  useEffect(() => {
    if (!tree.length || !itemCode) return;
    setSpecRows((prev) => (prev.some((r) => r.template) ? prev : withTemplate(prev, findItem(tree, category, itemCode))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree]);
  // The general layer's quantity + unit, stored together as the requirement's
  // quantity ("500 pcs"). A cloned free-text quantity keeps its number; its unit
  // is only kept if it's one of the options.
  const [qtyNumber, setQtyNumber] = useState(() => sanitizeWholeNumber(splitQuantity(initial?.quantity ?? '').number));
  const [qtyUnit, setQtyUnit] = useState(() => (initial?.quantity ? splitQuantity(initial.quantity).unit : 'pcs'));
  // Unit is a general spec, so any item's list works before one is picked.
  const unitOptions = (findItem(tree, category, itemCode) ?? tree[0]?.items[0])?.specs.find((s) => s.id === 'unit')?.options ?? [];
  const quantity = qtyNumber.trim() ? `${qtyNumber.trim()} ${qtyUnit}`.trim() : '';
  const [budgetMinText, setBudgetMinText] = useState(initial?.budgetMin != null ? String(initial.budgetMin) : '');
  const [budgetMaxText, setBudgetMaxText] = useState(initial?.budgetMax != null ? String(initial.budgetMax) : '');
  const [strictBudget, setStrictBudget] = useState(initial?.strictBudget ?? false);
  const [requiredDocuments, setRequiredDocuments] = useState<string[]>(initial?.requiredDocuments ?? []);
  const [docInput, setDocInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>(initial?.attachments ?? []);
  const [attempted, setAttempted] = useState(false);
  // "More details (optional)" — folded until opened, or while it has something in it.
  const [moreOpen, setMoreOpen] = useState(false);
  // "Write with AI": a draft that would replace typed text waits for a yes
  // (aiProposal); a replaced text can be brought back once (undoText).
  const [aiBusy, setAiBusy] = useState(false);
  const [aiProposal, setAiProposal] = useState<DetailDraftOut | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [undoText, setUndoText] = useState<string | null>(null);

  /** documentLabel marks a file added from a field (the Design file) — it still
   *  uploads as a plain reference file; the label only groups it on screen. */
  const addFile = async (documentLabel: string | null = null) => {
    if (isWebFilePickerSupported()) {
      const picked = await pickWebFile('.pdf,.doc,.docx,.jpg,.jpeg,.png,application/pdf,image/*');
      if (!picked) return; // dialog closed without picking — do nothing
      const id = `att-${Date.now()}`;
      pickedRequirementFiles.set(id, picked);
      setAttachments((prev) => [
        ...prev,
        { id, filename: picked.name, sizeBytes: picked.size, mimeType: picked.type, uri: '', documentLabel },
      ]);
      return;
    }
    // Native fallback — placeholder metadata only, no real bytes. Same escape hatch as
    // Onboarding.tsx's capture(); a native file picker is a separate follow-up.
    setAttachments((prev) => [
      ...prev,
      { id: `f${Date.now()}`, filename: 'New attachment.pdf', sizeBytes: 640_000, mimeType: 'application/pdf', uri: '', documentLabel },
    ]);
  };
  const removeFile = (id: string) => {
    setAttachments((prev) => prev.filter((f) => f.id !== id));
    pickedRequirementFiles.delete(id);
  };

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
    if (c !== category) {
      // The item and its template rows belong to the old category.
      setItemCode('');
      setSpecRows((prev) => prev.filter((r) => !r.template));
    }
    setCategory(c);
    // The category's typical documents are only offered as "Suggested" chips
    // (suggestedRemainingDocs) — nothing is added until the buyer taps one.
  }

  function selectItem(code: string) {
    setItemCode(code);
    setSpecRows((prev) => withTemplate(prev, findItem(tree, category, code)));
  }

  const budgetMin = num(budgetMinText);
  const budgetMax = num(budgetMaxText);
  const budgetReversed = budgetMin !== null && budgetMax !== null && budgetMin > budgetMax;
  // Indicative budget is required: both ends, each above zero.
  const budgetMinMissing = budgetMin === null;
  const budgetMaxMissing = budgetMax === null;
  const budgetZero = (budgetMin !== null && budgetMin <= 0) || (budgetMax !== null && budgetMax <= 0);

  const addSpecRow = () => setSpecRows((prev) => [...prev, { id: `spec${Date.now()}`, label: '', value: '' }]);
  const removeSpecRow = (id: string) => setSpecRows((prev) => prev.filter((r) => r.id !== id));
  const updateSpecRow = (id: string, field: 'label' | 'value', v: string) =>
    setSpecRows((prev) => prev.map((r) => {
      if (r.id !== id) return r;
      // A custom row's renamed label may mean something else — its matched
      // attribute and any pending suggestion go with the old label.
      if (field === 'label' && !r.template) return { ...r, label: v, attributeId: null, suggestion: null };
      return { ...r, [field]: v };
    }));

  /** "Did you mean …?" — asked once the buyer leaves a custom row's label.
   *  Advisory only: a failed or empty lookup just shows nothing. */
  async function checkSpecSuggestion(id: string) {
    const row = specRows.find((r) => r.id === id);
    const label = row?.label.trim() ?? '';
    if (!row || row.template || row.attributeId || label.length < SPEC_LABEL_MIN || row.suggestionDismissedFor === label) return;
    let found: { attributeId: string; label: string; unit: string | null } | null = null;
    try {
      const out = await suggestAttribute(label, category, itemCode);
      if (out.attribute_id && out.label) found = { attributeId: out.attribute_id, label: out.label, unit: out.unit };
    } catch {
      return;
    }
    // Not worth asking about an attribute the buyer already filled in above.
    if (found && specRows.some((r) => r.template && r.attributeId === found!.attributeId && r.value.trim())) found = null;
    setSpecRows((prev) => prev.map((r) => (r.id === id && r.label.trim() === label ? { ...r, suggestion: found } : r)));
  }

  function acceptSpecSuggestion(id: string) {
    setSpecRows((prev) => {
      const row = prev.find((r) => r.id === id);
      if (!row?.suggestion) return prev;
      const { attributeId, label, unit } = row.suggestion;
      // The item already has a row for it: the value moves there.
      if (prev.some((r) => r.template && r.attributeId === attributeId)) {
        return prev
          .filter((r) => r.id !== id)
          .map((r) => (r.template && r.attributeId === attributeId ? { ...r, value: row.value } : r));
      }
      return prev.map((r) => (r.id === id ? { ...r, label: specLabel({ label, unit }), attributeId, suggestion: null } : r));
    });
  }

  const dismissSpecSuggestion = (id: string) =>
    setSpecRows((prev) => prev.map((r) => (r.id === id ? { ...r, suggestion: null, suggestionDismissedFor: r.label.trim() } : r)));

  const templateRows = specRows.filter((r) => r.template);
  const customRows = specRows.filter((r) => !r.template);
  const filledSpecRows = customRows.filter((r) => r.label.trim() && r.value.trim());

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
  const validSpecRows = [
    // Template rows: the label is fixed, so only the value matters — and
    // itemSpecError below checks it against the template (required, select, number).
    ...templateRows.filter((r) => r.value.trim()),
    ...customRows.filter(isSpecRowValid),
  ];
  const badSpecRows = filledSpecRows.filter((r) => !isSpecRowValid(r));
  // Half-filled rows (a label with no value, or the reverse) used to be dropped
  // silently on Continue — now they block it, so nothing typed is lost unnoticed.
  const isSpecRowPartial = (r: SpecRowDraft) => !!r.label.trim() !== !!r.value.trim();
  const partialSpecRows = customRows.filter(isSpecRowPartial);
  const isOther = itemCode === OTHER_ITEM_CODE;
  const otherItemBad = isOther && otherItem.trim().length < SPEC_VALUE_MIN;
  const requiredRows = templateRows.filter((r) => r.template?.required);
  const optionalRows = templateRows.filter((r) => !r.template?.required);
  // "Other" has no item specs of its own, so the buyer's own rows are what
  // suppliers price from — at least one. Every listed item has its required rows.
  const otherNeedsDetail = isOther && customRows.filter(isSpecRowValid).length === 0;
  const moreShown = moreOpen || isOther || customRows.length > 0 || optionalRows.some((r) => r.value.trim());
  const designFiles = attachments.filter((a) => a.documentLabel === DESIGN_FILE_LABEL);
  const optionalSpecRows = optionalRows.map((row) => (
    <TemplateSpecRow key={row.id} row={row} missing={false} onChangeValue={(v) => updateSpecRow(row.id, 'value', v)} />
  ));
  const outputSpecs: SpecRow[] = [
    ...(isOther && !otherItemBad ? [{ label: OTHER_ITEM_LABEL, value: otherItem.trim(), attributeId: null }] : []),
    ...validSpecRows.map((r) => ({ label: r.label.trim(), value: r.value.trim(), attributeId: r.attributeId ?? null })),
  ];
  const itemDisplayName = isOther ? otherItem.trim() : findItem(tree, category, itemCode)?.name ?? '';

  async function writeWithAi() {
    if (!onDraftDetail || aiBusy) return;
    setAiBusy(true);
    setAiError(null);
    setAiProposal(null);
    try {
      const out = await onDraftDetail({
        category,
        item: itemDisplayName,
        title: title.trim(),
        specifications: specRows.filter((r) => r.label.trim() && r.value.trim()).map((r) => ({ label: r.label.trim(), value: r.value.trim() })),
        quantity,
        price_min: num(budgetMinText),
        price_max: num(budgetMaxText),
        strict_budget: strictBudget,
        current_text: scope,
      });
      // Never replace what the buyer typed without asking.
      if (scope.trim()) setAiProposal(out);
      else applyAiDraft(out);
    } catch {
      setAiError("Couldn't write it right now — try again, or write it yourself.");
    } finally {
      setAiBusy(false);
    }
  }
  function applyAiDraft(out: DetailDraftOut) {
    setUndoText(scope);
    setScope(out.text.slice(0, SCOPE_MAX));
    setAiNote(out.message);
    setAiProposal(null);
  }
  function undoAiDraft() {
    if (undoText === null) return;
    setScope(undoText);
    setUndoText(null);
    setAiNote(null);
  }
  // Same rules and wording as the backend (validate_item_specs).
  const templateError = category && itemCode && tree.length ? itemSpecError(tree, category, itemCode, outputSpecs, quantity) : null;
  const quantityBad = !!qtyNumber.trim() && (!isNumber(qtyNumber) || Number(qtyNumber) <= 0);

  const titleTooShort = title.trim().length > 0 && title.trim().length < TITLE_MIN;
  const scopeTooShort = scope.trim().length > 0 && scope.trim().length < SCOPE_MIN;

  const missing: string[] = [];
  if (!category) missing.push('a category');
  else if (!itemCode) missing.push('an item');
  else if (otherItemBad) missing.push('what the item is');
  if (!title.trim()) missing.push('a title');
  else if (titleTooShort) missing.push(`a title of at least ${TITLE_MIN} characters`);
  if (!scope.trim()) missing.push('the detail');
  else if (scopeTooShort) missing.push(`a detail of at least ${SCOPE_MIN} characters`);
  if (otherNeedsDetail) missing.push('at least one detail about the item');
  if (badSpecRows.length > 0) missing.push('a fix to the specification row marked below');
  if (partialSpecRows.length > 0) missing.push('both a label and a value on every specification row');
  if (templateError) missing.push(`the item's required specifications`);
  if (!qtyNumber.trim()) missing.push('quantity');
  else if (quantityBad) missing.push('a quantity more than 0');
  else if (!qtyUnit) missing.push('a unit for the quantity');
  if (budgetMinMissing || budgetMaxMissing) missing.push('an indicative budget (from and to)');
  if (requiredDocuments.length === 0) missing.push('at least one required document');

  const ready = missing.length === 0 && !budgetReversed && !budgetZero;

  const handleContinue = () => {
    if (!ready) {
      setAttempted(true);
      scrollToFirstError();
      return;
    }
    onContinue({
      category,
      itemCode,
      title: title.trim(),
      scope: scope.trim(),
      specifications: outputSpecs,
      quantity: quantity.trim(),
      budgetMin,
      budgetMax,
      strictBudget,
      requiredDocuments,
      attachments,
    });
  };
  reportContinue(handleContinue);

  return (
    <View style={styles.stepContent}>
      <ScreenTitle
        step="DETAILS"
        title="Post a requirement"
        subtitle={`Verified businesses in your category and service area are alerted the moment ${poster.displayName ?? poster.registeredName} publishes.`}
      />
      {attempted && missing.length > 0 && <SummaryBanner message={`Still needed before you continue: ${listOut(missing)}.`} />}

      <SectionCard index={1} title="What you need">
        <View>
          <FieldLabel>Category</FieldLabel>
          <View style={styles.categoryGrid}>
            {categories.map((c) => (
              <CategoryCard key={c} label={c} blurb={CATEGORY_BLURBS[c]} active={category === c} onPress={() => selectCategory(c)} />
            ))}
          </View>
          {treeError && <Text style={styles.errorText} {...VALIDATION_ERROR_MARK}>Couldn't load the categories — check your connection and reopen this page.</Text>}
          {attempted && !category && <Text style={styles.errorText} {...VALIDATION_ERROR_MARK}>Pick a category.</Text>}
          {!category && suggestedCategory && (
            <Pressable onPress={() => selectCategory(suggestedCategory)} style={styles.suggestionChip}>
              <Text style={styles.suggestionChipText}>
                Looks like <Text style={styles.ackBold}>{suggestedCategory}</Text> — tap to use it
              </Text>
            </Pressable>
          )}
        </View>

        {!!category && (
          <View>
            <FieldHeader label="Item" example={fieldExample(category, 'item')} />
            <Text style={styles.fieldCaption}>Picking one shows what suppliers need to know to price it. Not listed? Choose Other.</Text>
            <GridPicker
              value={itemCode}
              options={itemsFor(tree, category).map((item) => ({ value: item.code, label: item.name }))}
              placeholder="Choose an item"
              searchPlaceholder={`Search ${category} items`}
              invalid={attempted && !itemCode}
              onChange={selectItem}
            />
            {attempted && !itemCode && <Text style={styles.errorText} {...VALIDATION_ERROR_MARK}>Pick an item from {category}.</Text>}
            {isOther && (
              <View style={{ marginTop: space.md }}>
                <FieldHeader label="What item is it?" example={fieldExample(category, 'otherItem')} />
                <FormInput
                  value={otherItem}
                  onChangeText={setOtherItem}
                  maxLength={SPEC_VALUE_MAX}
                  placeholder="e.g. Acrylic keychains"
                  style={[styles.input, attempted && otherItemBad ? styles.inputError : null]}
                />
                {attempted && otherItemBad && (
                  <Text style={styles.errorText} {...VALIDATION_ERROR_MARK}>Name the item, so the right suppliers see it.</Text>
                )}
              </View>
            )}
          </View>
        )}

        <View>
          <FieldHeader label="Title" example={fieldExample(category, 'title')} />
          <FormInput
            value={title}
            onChangeText={setTitle}
            onBlur={() => void checkCategorySuggestion(title, scope)}
            maxLength={TITLE_MAX}
            placeholder={detailsExample.title}
            style={[styles.input, attempted && (titleTooShort || !title.trim()) ? styles.inputError : null]}
          />
          {attempted && !title.trim() && <Text style={styles.errorText} {...VALIDATION_ERROR_MARK}>Add a title.</Text>}
          {attempted && titleTooShort && (
            <Text style={styles.errorText} {...VALIDATION_ERROR_MARK}>Needs at least {TITLE_MIN} characters ({title.trim().length}/{TITLE_MIN}).</Text>
          )}
        </View>

        <View>
          <FieldHeader
            label="Detail"
            example={fieldExample(category, 'detail')}
            action={!!onDraftDetail && (
              <Pressable
                onPress={() => void writeWithAi()}
                disabled={aiBusy}
                accessibilityRole="button"
                style={({ pressed }) => [styles.aiButton, aiBusy && { opacity: 0.6 }, pressed && styles.pressedScale]}
              >
                <SparkGlyph />
                <Text style={styles.aiButtonLabel}>{aiBusy ? 'Writing…' : 'Write with AI'}</Text>
              </Pressable>
            )}
          />
          <FormInput
            value={scope}
            onChangeText={(v) => {
              setScope(v);
              // Typing over the AI text makes it the buyer's own — no undo past that.
              if (undoText !== null) setUndoText(null);
            }}
            onBlur={() => void checkCategorySuggestion(title, scope)}
            multiline
            numberOfLines={6}
            maxLength={SCOPE_MAX}
            placeholder={detailsExample.scope}
            style={[styles.textareaLarge, attempted && (scopeTooShort || !scope.trim()) ? styles.inputError : null]}
          />
          {attempted && !scope.trim() ? (
            <Text style={styles.errorText} {...VALIDATION_ERROR_MARK}>Describe what you need.</Text>
          ) : attempted && scopeTooShort ? (
            <Text style={styles.errorText} {...VALIDATION_ERROR_MARK}>Needs at least {SCOPE_MIN} characters ({scope.trim().length}/{SCOPE_MIN}).</Text>
          ) : (
            <Text style={styles.fieldCaption}>A vague detail produces quotations you cannot compare.</Text>
          )}
          {!!aiProposal && (
            <View style={styles.aiProposal}>
              <Text style={styles.aiProposalTitle}>Replace your text?</Text>
              <Text style={styles.aiProposalBody} numberOfLines={5}>{aiProposal.text}</Text>
              <View style={styles.aiProposalActions}>
                <ActionButton label="Replace" variant="primary" onPress={() => applyAiDraft(aiProposal)} />
                <ActionButton label="Keep mine" variant="outline" onPress={() => setAiProposal(null)} />
              </View>
            </View>
          )}
          {undoText !== null && (
            <View style={styles.aiNoteRow}>
              <Text style={[styles.fieldCaption, { flex: 1, marginTop: 0 }]}>{aiNote}</Text>
              <Pressable onPress={undoAiDraft} hitSlop={8} accessibilityRole="button">
                <Text style={styles.pickedChange}>Undo</Text>
              </Pressable>
            </View>
          )}
          {!!aiError && <Text style={styles.errorText}>{aiError}</Text>}
        </View>
      </SectionCard>

      <SectionCard
        index={2}
        title="Specifications"
        caption="What suppliers need to know to price it."
      >
        {!itemCode ? (
          <Text style={styles.emptyNote}>Pick an item above to see what suppliers need to know.</Text>
        ) : (
          <View style={{ gap: space.md }}>
            {requiredRows.map((row) => (
              <TemplateSpecRow
                key={row.id}
                row={row}
                missing={attempted && !row.value.trim()}
                onChangeValue={(v) => updateSpecRow(row.id, 'value', v)}
              >
                {row.attributeId === DESIGN_FILE_ID && row.value === DESIGN_FILE_READY && (
                  <View style={styles.designFileBox}>
                    <View style={[styles.pillGroupWrap, { marginTop: 0 }]}>
                      {designFiles.map((f) => (
                        <View key={f.id} style={styles.fileChip}>
                          <View style={styles.fileGlyph}>
                            <View style={styles.fileGlyphFold} />
                          </View>
                          <Text style={styles.fileChipName} numberOfLines={1}>{f.filename}</Text>
                          <Pressable onPress={() => removeFile(f.id)} hitSlop={8}>
                            <XGlyph tone={color.inkFaint} />
                          </Pressable>
                        </View>
                      ))}
                      <AddDashedButton label={designFiles.length ? 'Add another file' : 'Attach your design file'} onPress={() => void addFile(DESIGN_FILE_LABEL)} />
                    </View>
                    <Text style={styles.fieldCaption}>Optional — it goes into Reference files below, which every business browsing this requirement can open.</Text>
                  </View>
                )}
              </TemplateSpecRow>
            ))}
            {attempted && !!templateError && <Text style={styles.errorText} {...VALIDATION_ERROR_MARK}>{templateError}</Text>}

            <View style={styles.moreBox}>
              <Pressable
                onPress={() => setMoreOpen((v) => !v)}
                disabled={moreShown && !moreOpen}
                accessibilityRole="button"
                accessibilityState={{ expanded: moreShown }}
                style={styles.moreHeader}
              >
                <Text style={styles.moreTitle}>{isOther ? 'Details about the item' : 'More details (optional)'}</Text>
                {!(moreShown && !moreOpen) && <CaretGlyph open={moreShown} />}
              </Pressable>
              {isOther && (
                <Text style={styles.fieldCaption}>Add at least one — e.g. Size: 2 x 3 in, or Material: 3mm clear acrylic.</Text>
              )}
              {moreShown && (
                <View style={{ gap: space.md, marginTop: space.sm }}>
                  {/* "Other": the buyer's own details come first — they're the required part there. */}
                  {!isOther && optionalSpecRows}
                  <View>
                    <FieldHeader label="Your own details" optional={!isOther} example={COMMON_EXAMPLES.customSpec} />
                    {customRows.length > 0 && (
                      <View style={[styles.specHeaderRow, { marginTop: space.xs }]}>
                        <Text style={[styles.specHeaderLabel, { flex: 1 }]}>What</Text>
                        <Text style={[styles.specHeaderLabel, { flex: 2 }]}>Detail</Text>
                        <View style={{ width: 28 }} />
                      </View>
                    )}
                    <View style={{ gap: space.sm }}>
                      {customRows.map((row) => (
                        <SpecificationEditRow
                          key={row.id}
                          row={row}
                          invalid={attempted && row.label.trim() !== '' && row.value.trim() !== '' && !isSpecRowValid(row)}
                          partial={attempted && isSpecRowPartial(row)}
                          labelPlaceholder={(SPEC_EXAMPLE_BY_CATEGORY[category] ?? DEFAULT_SPEC_EXAMPLE).label}
                          valuePlaceholder={(SPEC_EXAMPLE_BY_CATEGORY[category] ?? DEFAULT_SPEC_EXAMPLE).value}
                          onChangeLabel={(v) => updateSpecRow(row.id, 'label', v)}
                          onChangeValue={(v) => updateSpecRow(row.id, 'value', v)}
                          onRemove={() => removeSpecRow(row.id)}
                          onBlurLabel={() => void checkSpecSuggestion(row.id)}
                          onAcceptSuggestion={() => acceptSpecSuggestion(row.id)}
                          onDismissSuggestion={() => dismissSpecSuggestion(row.id)}
                        />
                      ))}
                    </View>
                    {attempted && otherNeedsDetail && partialSpecRows.length === 0 && badSpecRows.length === 0 && (
                      <Text style={styles.errorText} {...VALIDATION_ERROR_MARK}>Add at least one detail — what it is and its value.</Text>
                    )}
                    <View style={{ marginTop: space.sm }}>
                      <AddDashedButton label="Add your own detail" onPress={addSpecRow} />
                    </View>
                  </View>
                  {isOther && optionalSpecRows}
                </View>
              )}
            </View>
          </View>
        )}
      </SectionCard>

      <SectionCard index={3} title="Quantity and budget">
        <View style={styles.twoColRow}>
          <View style={styles.twoCol}>
            <FieldHeader label="Quantity" example={COMMON_EXAMPLES.quantity} />
            <FormInput
              value={qtyNumber}
              onChangeText={(v) => setQtyNumber(sanitizeWholeNumber(v))}
              maxLength={QUANTITY_DIGITS_MAX}
              keyboardType="number-pad"
              inputMode="numeric"
              placeholder={detailsExample.quantity}
              style={[styles.input, attempted && (!qtyNumber.trim() || quantityBad) ? styles.inputError : null]}
            />
            <View style={[styles.pillGroupWrap, { marginTop: space.sm }]}>
              {unitOptions.map((u) => (
                <Pill key={u} label={u} active={qtyUnit === u} onPress={() => setQtyUnit(u)} />
              ))}
            </View>
            {attempted && !qtyNumber.trim() && <Text style={styles.errorText} {...VALIDATION_ERROR_MARK}>Add the quantity you need.</Text>}
            {attempted && quantityBad && <Text style={styles.errorText} {...VALIDATION_ERROR_MARK}>Quantity must be more than 0.</Text>}
            {attempted && !!qtyNumber.trim() && !quantityBad && !unitOptions.includes(qtyUnit) && (
              <Text style={styles.errorText} {...VALIDATION_ERROR_MARK}>Pick a unit for the quantity.</Text>
            )}
          </View>
          <View style={styles.twoCol}>
            <FieldHeader label="Indicative budget" example={COMMON_EXAMPLES.budget} />
            <View style={styles.budgetRow}>
              <BudgetField
                value={budgetMinText}
                onChange={setBudgetMinText}
                placeholder="From"
                invalid={attempted && (budgetReversed || budgetMinMissing || (budgetMin !== null && budgetMin <= 0))}
              />
              <Text style={styles.budgetSep}>—</Text>
              <BudgetField
                value={budgetMaxText}
                onChange={setBudgetMaxText}
                placeholder="To"
                invalid={attempted && (budgetReversed || budgetMaxMissing || (budgetMax !== null && budgetMax <= 0))}
              />
            </View>
            {attempted && (budgetMinMissing || budgetMaxMissing) ? (
              <Text style={styles.errorText} {...VALIDATION_ERROR_MARK}>
                {budgetMinMissing && budgetMaxMissing
                  ? 'Add a budget range — both from and to.'
                  : budgetMinMissing
                    ? 'Add the starting amount (from).'
                    : 'Add the maximum amount (to).'}
              </Text>
            ) : attempted && budgetZero ? (
              <Text style={styles.errorText} {...VALIDATION_ERROR_MARK}>Amounts must be more than ₱0.</Text>
            ) : attempted && budgetReversed ? (
              <Text style={styles.errorText} {...VALIDATION_ERROR_MARK}>That reads as a smaller maximum than minimum.</Text>
            ) : (
              <Text style={styles.fieldCaption}>Shown to respondents so their quotations land in a realistic range.</Text>
            )}
            <Pressable
              onPress={() => setStrictBudget((v) => !v)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: strictBudget }}
              style={styles.strictRow}
            >
              <View style={[styles.strictBox, strictBudget ? styles.strictBoxOn : null]}>
                {strictBudget && <Text style={styles.strictCheck}>✓</Text>}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.strictLabel}>Strict maximum — don't accept quotations above it</Text>
                <Text style={styles.fieldCaption}>
                  {strictBudget
                    ? 'Suppliers see "Strict maximum" and can\'t seal a higher price. Some may not quote at all.'
                    : 'Off: suppliers may quote above it, but must tell you why. You see the reason when quotations open.'}
                </Text>
              </View>
            </Pressable>
          </View>
        </View>
      </SectionCard>

      <SectionCard
        index={4}
        title="Required documents"
        caption="Qualifying documents each respondent should attach to their quotation. Add at least one."
        example={COMMON_EXAMPLES.documents}
      >
        <View>
          <View style={[styles.pillGroupWrap, { marginTop: 0 }]}>
            {requiredDocuments.map((d) => (
              <Pressable key={d} onPress={() => removeRequiredDoc(d)} style={styles.docChip}>
                <Text style={styles.docChipLabel}>{d}</Text>
                <XGlyph tone={color.primary} />
              </Pressable>
            ))}
            {requiredDocuments.length === 0 && (
              <Text style={attempted ? styles.errorTextInline : styles.emptyNote} {...(attempted ? VALIDATION_ERROR_MARK : {})}>
                {attempted ? 'Add at least one required document.' : 'No documents yet — pick a suggestion or type one below.'}
              </Text>
            )}
          </View>
          {suggestedRemainingDocs.length > 0 && (
            <View style={styles.suggestRow}>
              <Text style={styles.suggestLabel}>Suggested</Text>
              {suggestedRemainingDocs.map((d) => (
                <Pill key={d} label={`+ ${d}`} active={false} onPress={() => addSuggestedDoc(d)} />
              ))}
            </View>
          )}
          <View style={styles.addDocRow}>
            <FormInput
              value={docInput}
              onChangeText={setDocInput}
              onSubmitEditing={addRequiredDoc}
              placeholder="Or type your own"
              style={[styles.input, { flex: 1, marginTop: 0 }]}
            />
            <ActionButton label="Add" variant="outline" onPress={addRequiredDoc} />
          </View>
        </View>
      </SectionCard>

      <SectionCard
        index={5}
        title="Reference files"
        optional
        caption="A floor plan, product photo or sample design. Visible to every business browsing this requirement, not just respondents."
        example={COMMON_EXAMPLES.files}
      >
        <View style={[styles.pillGroupWrap, { marginTop: 0 }]}>
          {attachments.map((f) => (
            <View key={f.id} style={styles.fileChip}>
              <View style={styles.fileGlyph}>
                <View style={styles.fileGlyphFold} />
              </View>
              <Text style={styles.fileChipName} numberOfLines={1}>{f.filename}</Text>
              {!!f.documentLabel && <Text style={styles.fileChipTag}>{f.documentLabel}</Text>}
              <Pressable onPress={() => removeFile(f.id)} hitSlop={8}>
                <XGlyph tone={color.inkFaint} />
              </Pressable>
            </View>
          ))}
          <AddDashedButton label="Add file" onPress={() => void addFile()} />
        </View>
      </SectionCard>
    </View>
  );
}

/** ₱-prefixed numeric field — the border lives on the wrapper, so focus does too. */
function BudgetField({
  value,
  onChange,
  placeholder,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  invalid?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View
      style={[
        styles.budgetField,
        webTransition('border-color, background-color, box-shadow'),
        focused && styles.inputFocused,
        invalid ? styles.inputError : null,
      ]}
    >
      <Text style={styles.budgetCurrency}>₱</Text>
      <TextInput
        value={value}
        onChangeText={(v) => onChange(sanitizeNumeric(v))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        placeholderTextColor={color.inkFaint}
        keyboardType="decimal-pad"
        style={styles.budgetInput}
      />
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
  // Delivery is scoped to Metro Manila like onboarding — a cloned requirement
  // whose city isn't one of the NCR cities starts unselected.
  const [city, setCity] = useState<string>(() => {
    const saved = initial?.city ?? '';
    return NCR_CITIES.includes(saved) ? saved : '';
  });
  const [address, setAddress] = useState(initial?.address ?? '');
  const { byCity, error: addressDataError } = useNcrAddresses();
  const [barangay, setBarangay] = useState(initial?.barangay ?? '');
  const [barangayQuery, setBarangayQuery] = useState('');
  const [zipCode, setZipCode] = useState(initial?.zipCode ?? '');
  // The ZIP the picked barangay filled in, if any — lets the caption say so
  // until the buyer types over it.
  const [autoZip, setAutoZip] = useState<string | null>(null);
  const cityData = city ? byCity[city] : undefined;
  // Barangay comes before city in the form: before a city is picked it searches
  // every Metro Manila barangay (with its city, since names repeat across cities),
  // and picking one fills in the city.
  const addressDataReady = Object.keys(byCity).length > 0;
  const barangayMatches = useMemo(() => {
    const q = foldName(barangayQuery);
    const pool = cityData
      ? cityData.barangays.map((b) => ({ ...b, city }))
      : !q
      ? []
      : Object.values(byCity).flatMap((c) => c.barangays.map((b) => ({ ...b, city: c.city })));
    const all = q ? pool.filter((b) => foldName(b.name).includes(q)) : pool;
    // Within a city: every barangay, in a scrolling list. Across Metro Manila: capped.
    return cityData ? all : all.slice(0, BARANGAY_SEARCH_MAX);
  }, [byCity, cityData, city, barangayQuery]);
  const zipSuggestions = useMemo(
    () => (cityData?.zips ?? []).filter((z) => z.zip.startsWith(zipCode)).slice(0, BARANGAY_MATCHES_SHOWN),
    [cityData, zipCode],
  );
  const barangayValid = !!barangay && !!cityData?.barangays.some((b) => b.name === barangay);
  const zipValid = /^\d{4}$/.test(zipCode);

  const pickCity = (c: string) => {
    if (c === city) return;
    setCity(c);
    // A barangay and ZIP belong to one city — start them over.
    setBarangay('');
    setBarangayQuery('');
    setZipCode('');
    setAutoZip(null);
  };
  const pickBarangay = (b: { name: string; zip: string | null; city: string }) => {
    if (b.city !== city) setCity(b.city);
    setBarangay(b.name);
    setBarangayQuery('');
    setAutoZip(b.zip);
    setZipCode(b.zip ?? '');
  };
  const [windowFrom, setWindowFrom] = useState(initial?.windowFrom ?? '');
  const [windowTo, setWindowTo] = useState(initial?.windowTo ?? '');
  const [attempted, setAttempted] = useState(false);

  // DateField only ever writes a real picked date, so these mainly guard the native
  // fallback (no picker there yet — see DateField's comment above).
  const windowFromInvalid = !!windowFrom && !isValidDateString(windowFrom);
  const windowToInvalid = !!windowTo && !isValidDateString(windowTo);
  const windowBad =
    !!windowFrom && !!windowTo && !windowFromInvalid && !windowToInvalid && new Date(windowTo) < new Date(windowFrom);
  // A delivery can't be planned for a day that's already gone. "YYYY-MM-DD"
  // strings compare correctly as plain strings, so no Date parsing needed.
  const today = todayPHDateString();
  const windowFromPast = !!windowFrom && !windowFromInvalid && windowFrom < today;
  const windowToPast = !!windowTo && !windowToInvalid && windowTo < today;
  const windowPast = windowFromPast || windowToPast;

  const missing: string[] = [];
  if (!address.trim()) missing.push('the street, building or unit number');
  if (!barangayValid) missing.push('a barangay');
  if (!city) missing.push('a delivery city');
  if (city && !zipValid) missing.push('a 4-digit ZIP code');
  if (!windowFrom || !windowTo) missing.push('a delivery window');

  const ready = missing.length === 0 && !windowBad && !windowPast && !windowFromInvalid && !windowToInvalid;

  const handleContinue = () => {
    if (!ready) {
      setAttempted(true);
      scrollToFirstError();
      return;
    }
    onContinue({ city, address: address.trim(), barangay, zipCode, windowFrom, windowTo });
  };
  reportContinue(handleContinue);

  return (
    <View style={styles.stepContent}>
      <ScreenTitle step="DELIVERY" title="Where and when" subtitle="The delivery location and the window respondents should plan around." />
      {attempted && windowPast && <SummaryBanner message="The delivery window has a date that has already passed — pick today or a later date." />}
      {attempted && windowBad && <SummaryBanner message="The delivery window ends before it starts — fix the dates below." />}
      {attempted && missing.length > 0 && <SummaryBanner message={`Still needed before you continue: ${listOut(missing)}.`} />}

      <SectionCard index={1} title="Delivery location" caption="TrustLink currently covers Metro Manila.">
        <View>
          <FieldLabel>Street / Building / Unit Number</FieldLabel>
          <FormInput
            value={address}
            onChangeText={setAddress}
            maxLength={SITE_ADDRESS_MAX}
            placeholder="e.g. Unit 4B, Tektite Tower, Exchange Rd."
            style={[styles.input, attempted && !address.trim() ? styles.inputError : null]}
          />
          {attempted && !address.trim() && (
            <Text style={styles.errorText} {...VALIDATION_ERROR_MARK}>Add the street, building or unit number.</Text>
          )}
        </View>
        <View>
          <FieldLabel>Barangay</FieldLabel>
          {barangayValid ? (
            <View style={styles.pickedRow}>
              <Text style={styles.pickedValue}>{barangayLabel(barangay)}</Text>
              <Pressable onPress={() => { setBarangay(''); setAutoZip(null); }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Change barangay">
                <Text style={styles.pickedChange}>Change</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <FormInput
                value={barangayQuery}
                onChangeText={setBarangayQuery}
                editable={addressDataReady}
                maxLength={120}
                placeholder={
                  addressDataError ? "Couldn't load the barangay list — reload the page"
                  : !addressDataReady ? 'Loading barangays…'
                  : cityData ? `Search ${cityData.barangays.length} barangays in ${city}`
                  : 'Search a barangay in Metro Manila'
                }
                style={[styles.input, attempted && !barangayValid ? styles.inputError : null]}
              />
              {(!!cityData || !!barangayQuery.trim()) && addressDataReady && (
                <ScrollView style={styles.optionList} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                  {barangayMatches.length === 0 ? (
                    <Text style={styles.optionEmpty}>No barangay {city ? `in ${city} ` : ''}matches "{barangayQuery}".</Text>
                  ) : (
                    barangayMatches.map((b) => (
                      <Pressable key={`${b.city}-${b.name}`} onPress={() => pickBarangay(b)} style={({ pressed }) => [styles.optionRow, pressed ? styles.optionRowPressed : null]}>
                        <Text style={styles.optionName}>{b.name}{cityData ? '' : ` · ${b.city}`}</Text>
                        {b.zip && <Text style={styles.optionMeta}>{b.zip}</Text>}
                      </Pressable>
                    ))
                  )}
                </ScrollView>
              )}
              {attempted && !barangayValid && (
                <Text style={styles.errorText} {...VALIDATION_ERROR_MARK}>Pick the barangay from the list.</Text>
              )}
            </>
          )}
        </View>

        <View>
          <FieldLabel>City</FieldLabel>
          <View style={styles.pillGroupWrap}>
            {NCR_CITIES.map((c) => (
              <Pill key={c} label={c} active={city === c} onPress={() => pickCity(c)} />
            ))}
          </View>
          {attempted && !city && <Text style={styles.errorText} {...VALIDATION_ERROR_MARK}>Pick the city the delivery goes to.</Text>}
        </View>

        <View>
          <FieldLabel>ZIP code</FieldLabel>
          <FormInput
            value={zipCode}
            onChangeText={(v) => setZipCode(v.replace(/[^0-9]/g, '').slice(0, 4))}
            maxLength={4}
            keyboardType="number-pad"
            inputMode="numeric"
            editable={!!city}
            placeholder={city ? 'e.g. 1605' : 'Pick a city first'}
            style={[styles.input, styles.zipInput, attempted && city && !zipValid ? styles.inputError : null]}
          />
          {!!autoZip && zipCode === autoZip ? (
            <Text style={styles.fieldCaption}>Filled in from the barangay — change it if it's wrong.</Text>
          ) : (
            !!cityData && !zipValid && zipSuggestions.length > 0 && (
              <>
                <Text style={styles.fieldCaption}>
                  {barangayValid ? `Pick the ZIP for ${barangayLabel(barangay)}:` : `ZIP codes in ${city}:`}
                </Text>
                <View style={styles.pillGroupWrap}>
                  {zipSuggestions.map((z) => (
                    <Pill key={z.zip} label={`${z.zip} · ${z.area}`} active={false} onPress={() => setZipCode(z.zip)} />
                  ))}
                </View>
              </>
            )
          )}
          {attempted && city && !zipValid && (
            <Text style={styles.errorText} {...VALIDATION_ERROR_MARK}>Add the 4-digit ZIP code.</Text>
          )}
        </View>

      </SectionCard>

      <SectionCard index={2} title="Delivery window" caption="The dates respondents should plan their delivery around.">
        <View>
          <View style={[styles.dateRangeRow, { marginTop: 0 }]}>
            <DateField
              value={windowFrom}
              onPick={setWindowFrom}
              placeholder="Start date"
              min={today}
              error={windowFromPast || (attempted && (windowBad || windowFromInvalid))}
            />
            <Text style={styles.toLabel}>to</Text>
            <DateField
              value={windowTo}
              onPick={setWindowTo}
              placeholder="End date"
              min={windowFrom && !windowFromInvalid && windowFrom > today ? windowFrom : today}
              error={windowToPast || (attempted && (windowBad || windowToInvalid))}
            />
          </View>
          {!!windowFrom && !!windowTo && !windowBad && !windowPast && !windowFromInvalid && !windowToInvalid && (
            <Text style={styles.fieldCaption}>{formatWindow(windowFrom, windowTo)}</Text>
          )}
          {/* Shown as soon as a past date is picked, not only after Continue —
              there's no reason to let someone carry on thinking it's fine. */}
          {windowPast && (
            <Text style={styles.errorText} {...VALIDATION_ERROR_MARK}>
              {windowFromPast && windowToPast
                ? 'Both dates have already passed.'
                : windowFromPast
                  ? 'The start date has already passed.'
                  : 'The end date has already passed.'}{' '}
              Pick today ({formatDate(`${today}T00:00:00`)}) or later.
            </Text>
          )}
          {!windowPast && windowBad && <Text style={styles.errorText} {...VALIDATION_ERROR_MARK}>The end date is before the start date.</Text>}
          {attempted && !windowBad && (windowFromInvalid || windowToInvalid) && (
            <Text style={styles.errorText} {...VALIDATION_ERROR_MARK}>Pick a date using the calendar field.</Text>
          )}
        </View>
      </SectionCard>

    </View>
  );
}

/* ─── STEP 3 — CLOSING ───────────────────────────────
 * Closing date, closing time, quick duration presets — the highest-weight field on the
 * whole flow, called out once, plainly, as unchangeable after publish. */

/** One line at the closing step — the rule is the server's (GET /meta/rules). */
function ClosingMinimumNote() {
  const { minQuotations, autoExtendDays } = useMarketRules();
  return (
    <Text style={styles.fieldCaption}>
      Needs at least {minQuotations} quotations to award. If fewer arrive, closing extends {autoExtendDays} days once, then the requirement is archived unopened.
    </Text>
  );
}

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
      scrollToFirstError();
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
        step="CLOSING"
        title="Set your quotation closing time"
        subtitle="Once the requirement closes, no new quotations can be submitted and sealed quotations are released simultaneously."
      />
      {attempted && missing.length > 0 && <SummaryBanner message={`Still needed before you continue: ${listOut(missing)}.`} />}
      {attempted && closingInPast && <SummaryBanner message="This closes in the past — pick a later date and time." />}

      <View style={styles.closingCard}>
        <View style={styles.closingLockBanner}>
          <View style={styles.lockGlyph}>
            <View style={styles.lockGlyphShackle} />
            <View style={styles.lockGlyphBody} />
          </View>
          <Text style={[styles.closingLockNote, { flex: 1 }]}>
            <Text style={styles.ackBold}>Closing time cannot be changed after publishing.</Text> Choose a time that gives businesses
            enough room to prepare a competitive quotation.
          </Text>
        </View>

        <View>
          <FieldLabel>Quick pick</FieldLabel>
          <View style={styles.pillGroupWrap}>
            {CLOSING_PRESETS.map((p) => (
              <Pill key={p.label} label={p.label} active={closeDate === daysFromNowDateString(p.days)} onPress={() => applyPreset(p.days)} />
            ))}
          </View>
        </View>
        <ClosingMinimumNote />

        <View style={styles.twoColRow}>
          <View style={styles.twoCol}>
            <FieldLabel>Closing date</FieldLabel>
            <View style={styles.dateRangeRow}>
              <DateField value={closeDate} onPick={setCloseDate} placeholder="Closing date" error={attempted && closingInPast} />
            </View>
          </View>
          <View style={[styles.twoCol, { flexGrow: 2 }]}>
            <FieldLabel>Closing time</FieldLabel>
            <View style={styles.pillGroupWrap}>
              {TIME_OPTIONS.map((t) => (
                <Pill key={t.value} label={t.label} active={closeTime === t.value} onPress={() => setCloseTime(t.value)} />
              ))}
            </View>
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
    <SectionCard title={title}>
      <View style={styles.summaryList}>{children}</View>
    </SectionCard>
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
      <Text style={styles.sealedHeading}>Quotations stay sealed until {formatDateTime(closingAt)}</Text>
      <InfoHint
        label="Why sealed?"
        text="Every quotation stays hidden — from you, and from every other business quoting. At closing, every sealed quotation opens at once, so no business ever prices against one it was never allowed to see."
      />
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
          <Text style={styles.ackBold}>{formatDateTime(draft.closingAt)}</Text>, and that the detail and specifications, quantity, indicative
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
  const { tree } = useCategoryTree();
  const itemName = findItem(tree, draft.category, draft.itemCode)?.name ?? '';

  const handlePublish = () => {
    if (!ack) {
      setAttempted(true);
      scrollToFirstError();
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
    ? draft.specifications.map((s) => `${s.label}: ${specDisplayValue(s)}`).join('\n')
    : '';
  const attachmentsText = draft.attachments.length > 0 ? draft.attachments.map((a) => a.filename).join(', ') : 'None';
  const locationText = [
    draft.deliveryAddress,
    draft.deliveryBarangay ? barangayLabel(draft.deliveryBarangay) : '',
    `${draft.deliveryCity}${draft.deliveryZip ? ` ${draft.deliveryZip}` : ''}`,
  ].filter(Boolean).join(', ');

  return (
    <View style={styles.stepContent}>
      <ScreenTitle step="REVIEW" title="Review and publish" subtitle="Check the details below, then publish." />

      <View style={{ gap: space.lg }}>
        <SummaryGroup title="What you need">
          <SummaryLine label="Category" value={draft.category} />
          {!!itemName && <SummaryLine label="Item" value={itemName} />}
          <SummaryLine label="Title" value={draft.title} />
          <SummaryBlock label="Detail" value={draft.scope} />
          {!!specText && <SummaryBlock label="Specifications" value={specText} />}
          <SummaryLine label="Quantity" value={draft.quantity} />
          <SummaryLine label={draft.strictBudget ? "Budget (strict maximum)" : "Indicative budget"} value={formatBudget(draft.budgetMin, draft.budgetMax)} />
          <SummaryLine label="Required documents" value={draft.requiredDocuments.length > 0 ? draft.requiredDocuments.join(', ') : 'None'} />
        </SummaryGroup>

        <SummaryGroup title="Where and when">
          <SummaryLine label="Location" value={locationText} />
          <SummaryLine label="Delivery window" value={formatWindow(draft.deliveryWindowFrom, draft.deliveryWindowTo)} />
          <SummaryLine label="Attachments" value={attachmentsText} />
        </SummaryGroup>

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
  strictRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, marginTop: space.md },
  strictBox: { width: 20, height: 20, marginTop: 1, borderRadius: radius.sm, borderWidth: 1.5, borderColor: color.borderStrong, alignItems: 'center', justifyContent: 'center' },
  strictBoxOn: { backgroundColor: color.primary, borderColor: color.primary },
  strictCheck: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.onPrimary, lineHeight: fontSize.sm + 2 },
  strictLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.ink },
  root: { flex: 1, backgroundColor: color.surfaceSunken },

  shellHeader: { width: '100%', paddingHorizontal: layout.screenPadding, paddingVertical: space.lg, backgroundColor: color.surface, borderBottomWidth: 1, borderBottomColor: color.border },
  breadcrumbRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  breadcrumbLink: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkFaint },
  breadcrumbSep: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkFaint },
  breadcrumbCurrent: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted },

  shellScroll: { flex: 1 },
  shellScrollContent: { alignItems: 'center' },
  shellInner: { width: '100%', maxWidth: FORM_CONTENT_MAX_WIDTH, paddingHorizontal: layout.screenPadding, paddingTop: space.xxxl, paddingBottom: space.xxxl },

  bottomBar: { width: '100%', alignItems: 'center', backgroundColor: color.surface, borderTopWidth: 1, borderTopColor: color.border },
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

  hero: { gap: space.xs, marginBottom: space.xs },
  heroEyebrow: { fontFamily: font.monoMedium, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.primary, marginBottom: space.xs },
  pageTitle: { fontFamily: font.display, fontSize: fontSize.display, lineHeight: lineHeight.display, letterSpacing: letterSpacing.tight, color: color.ink },
  pageSubtitle: { maxWidth: 520, fontFamily: font.body, fontSize: fontSize.base, lineHeight: lineHeight.base, color: color.inkMuted },

  sectionLabel: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.inkFaint },

  fieldLabel: { fontFamily: font.bodySemi, fontSize: fontSize.base, color: color.ink },
  fieldLabelOptional: { fontFamily: font.body, color: color.inkFaint },
  templateSpecLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.ink, marginBottom: space.xs },
  fieldCaption: { marginTop: space.xs, fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  errorText: { marginTop: space.xs, fontFamily: font.body, fontSize: fontSize.sm, color: color.danger },
  errorTextInline: { fontFamily: font.body, fontSize: fontSize.sm, color: color.danger },
  addDocRow: { flexDirection: 'row', gap: space.sm, marginTop: space.sm, alignItems: 'center' },

  formDivider: { height: 1, backgroundColor: color.borderFaint },

  input: { marginTop: space.xs, minHeight: layout.minTouchTarget, backgroundColor: color.canvas, borderWidth: 1, borderColor: color.border, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, fontFamily: font.body, fontSize: fontSize.base, color: color.ink },
  inputFocused: {
    borderColor: color.primary,
    backgroundColor: color.surface,
    ...(Platform.OS === 'web' ? ({ boxShadow: `0 0 0 3px ${color.primaryFaint}`, outlineStyle: 'none' } as object) : null),
  },
  inputError: { borderColor: color.dangerBorder },
  textareaLarge: { marginTop: space.xs, minHeight: 150, backgroundColor: color.canvas, borderWidth: 1, borderColor: color.border, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, fontFamily: font.body, fontSize: fontSize.base, lineHeight: lineHeight.base, color: color.ink, textAlignVertical: 'top' },
  mono: { fontFamily: font.monoMedium },

  twoColRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
  twoCol: { flexGrow: 1, flexBasis: 200, minWidth: 180 },

  budgetRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs },
  budgetField: { flex: 1, minWidth: 0, minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: space.xs, borderWidth: 1, borderColor: color.border, borderRadius: radius.md, backgroundColor: color.canvas, paddingHorizontal: space.md, paddingVertical: space.sm },
  budgetCurrency: { fontFamily: font.mono, fontSize: fontSize.sm, color: color.inkFaint },
  budgetInput: { flex: 1, minWidth: 0, fontFamily: font.monoMedium, fontSize: fontSize.sm, color: color.ink },
  budgetSep: { color: color.inkFaint },

  dateRangeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap', marginTop: space.xs },
  toLabel: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkFaint },
  dateField: { flex: 1, minWidth: 140, marginTop: 0, justifyContent: 'center' },
  dateFieldText: { fontFamily: font.monoMedium, fontSize: fontSize.base, color: color.ink },
  dateFieldPlaceholder: { fontFamily: font.body, color: color.inkFaint },

  pillGroupWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.sm },
  /* barangay search + picked value */
  optionList: { maxHeight: 280, marginTop: space.xs, borderWidth: 1, borderColor: color.border, borderRadius: radius.md, backgroundColor: color.surface, overflow: 'hidden' },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: color.borderFaint },
  optionRowPressed: { backgroundColor: color.surfaceSunken },
  optionName: { flex: 1, fontFamily: font.body, fontSize: fontSize.sm, color: color.ink },
  optionMeta: { fontFamily: font.mono, fontSize: fontSize.micro, color: color.inkFaint },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, flexWrap: 'wrap' },
  labelActions: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  exampleLink: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.primary },
  exampleShot: { marginTop: space.xs, marginBottom: space.sm, gap: space.xs, borderWidth: 1, borderStyle: 'dashed', borderColor: color.primaryBorder, borderRadius: radius.md, backgroundColor: color.surfaceSunken, padding: space.md },
  exampleEyebrow: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, color: color.primary },
  exampleLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.ink },
  exampleField: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: color.canvas, borderWidth: 1, borderColor: color.border, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  exampleFieldTall: { alignItems: 'flex-start', minHeight: 96 },
  exampleValue: { flex: 1, minWidth: 0, fontFamily: font.body, fontSize: fontSize.base, lineHeight: lineHeight.base, color: color.ink },
  exampleTip: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  unitInputRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  unitSuffix: { marginTop: space.xs, fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.inkMuted },
  designFileBox: { marginTop: space.sm, borderLeftWidth: 2, borderLeftColor: color.primaryBorder, paddingLeft: space.md },
  fileChipTag: { fontFamily: font.mono, fontSize: fontSize.micro, color: color.primary },
  moreBox: { borderTopWidth: 1, borderTopColor: color.borderFaint, paddingTop: space.md },
  moreHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, minHeight: 32 },
  moreTitle: { fontFamily: font.bodySemi, fontSize: fontSize.base, color: color.ink },
  aiButton: { flexDirection: 'row', alignItems: 'center', gap: space.xs, borderWidth: 1, borderColor: color.primaryBorder, backgroundColor: color.primaryFaint, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.xs },
  aiButtonLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.primary },
  sparkGlyph: { width: 10, height: 10, alignItems: 'center', justifyContent: 'center' },
  sparkGlyphBar: { position: 'absolute', width: 7, height: 7, backgroundColor: color.primary, borderRadius: 1 },
  aiProposal: { marginTop: space.sm, gap: space.sm, borderWidth: 1, borderColor: color.primaryBorder, backgroundColor: color.primaryFaint, borderRadius: radius.md, padding: space.md },
  aiProposalTitle: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.ink },
  aiProposalBody: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  aiProposalActions: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  aiNoteRow: { marginTop: space.xs, flexDirection: 'row', alignItems: 'center', gap: space.md },
  selectField: { marginTop: space.xs, minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: color.canvas, borderWidth: 1, borderColor: color.border, borderRadius: radius.md, paddingHorizontal: space.md },
  selectFieldHovered: { borderColor: color.borderStrong },
  selectValue: { flex: 1, minWidth: 0, fontFamily: font.body, fontSize: fontSize.base, color: color.ink },
  selectPlaceholder: { color: color.inkFaint },
  caretGlyph: { width: 8, height: 8, marginTop: -3, borderRightWidth: 2, borderBottomWidth: 2, borderColor: color.inkMuted },
  gridPanel: { marginTop: space.xs, gap: space.sm, borderRadius: radius.md, backgroundColor: color.surface, padding: space.sm, ...elevation.card },
  gridScroll: { maxHeight: 3 * 64 + 2 * space.sm + 4 },
  gridTiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  gridTile: { flexBasis: '31%', flexGrow: 1, maxWidth: '33%', minHeight: 64, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: color.border, borderRadius: radius.md, backgroundColor: color.canvas, paddingHorizontal: space.sm, paddingVertical: space.sm },
  gridTileHovered: { borderColor: color.borderStrong, backgroundColor: color.surfaceSunken },
  gridTileActive: { borderColor: color.primary, backgroundColor: color.primaryFaint },
  gridTileLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.ink, textAlign: 'center' },
  gridTileLabelActive: { fontFamily: font.bodySemi, color: color.primary },
  gridTileMeta: { marginTop: 2, fontFamily: font.body, fontSize: fontSize.micro, color: color.inkMuted, textAlign: 'center' },
  optionEmpty: { padding: space.md, fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted },
  pickedRow: { marginTop: space.xs, minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: space.md, borderWidth: 1, borderColor: color.primaryBorder, backgroundColor: color.primaryFaint, borderRadius: radius.md, paddingHorizontal: space.md },
  pickedValue: { flex: 1, fontFamily: font.bodySemi, fontSize: fontSize.base, color: color.ink },
  pickedChange: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.primary },
  zipInput: { maxWidth: 160 },
  pill: { borderWidth: 1, borderColor: color.border, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.xs + 2 },
  pillHovered: { borderColor: color.borderStrong, backgroundColor: color.surface },
  pillActive: { backgroundColor: color.primaryFaint, borderColor: color.primary },
  pressedScale: { transform: [{ scale: 0.97 }] },
  pillLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.inkMuted },
  pillLabelActive: { color: color.primary },

  fileChip: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderColor: color.border, borderRadius: radius.md, backgroundColor: color.canvas, paddingHorizontal: space.md, paddingVertical: space.sm, maxWidth: 260 },
  // Page-with-folded-corner, from two Views — no icon library.
  fileGlyph: { width: 12, height: 15, borderWidth: 1.4, borderColor: color.primary, borderRadius: 2, borderTopRightRadius: 5 },
  fileGlyphFold: { position: 'absolute', top: -1, right: -1, width: 5, height: 5, borderLeftWidth: 1.4, borderBottomWidth: 1.4, borderColor: color.primary, backgroundColor: color.canvas },
  fileChipName: { flexShrink: 1, fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.ink },
  addDashed: { alignSelf: 'flex-start', borderWidth: 1, borderStyle: 'dashed', borderColor: color.border, borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: space.sm },
  addDashedHovered: { borderColor: color.primary, backgroundColor: color.primaryFaint },
  addDashedLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.inkMuted },
  addDashedLabelHovered: { color: color.primary },

  /* section cards */
  sectionCard: { ...elevation.card, borderRadius: radius.xl, backgroundColor: color.surface, padding: space.xxl },
  sectionCardCompact: { padding: space.lg },
  sectionCardHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  sectionBadge: { width: 24, height: 24, borderRadius: radius.pill, backgroundColor: color.primaryFaint, alignItems: 'center', justifyContent: 'center' },
  sectionBadgeLabel: { fontFamily: font.monoMedium, fontSize: fontSize.micro, color: color.primary },
  sectionCardTitle: { flex: 1, fontFamily: font.display, fontSize: fontSize.md, letterSpacing: letterSpacing.tight, color: color.ink },
  sectionCardCaption: { marginTop: space.xs, fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  sectionCardBody: { marginTop: space.lg, gap: space.lg },
  optionalTag: { borderWidth: 1, borderColor: color.border, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2 },
  optionalTagLabel: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: 1, textTransform: 'uppercase', color: color.inkFaint },

  /* category cards */
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  categoryCard: { flexGrow: 1, flexBasis: 220, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, backgroundColor: color.canvas, padding: space.md, gap: space.xs },
  categoryCardHovered: { borderColor: color.borderStrong, backgroundColor: color.surface },
  categoryCardActive: { borderColor: color.primary, backgroundColor: color.primaryFaint },
  categoryCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  categoryCardTitle: { fontFamily: font.bodySemi, fontSize: fontSize.base, color: color.ink },
  categoryCardTitleActive: { color: color.primary },
  categoryCardBlurb: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  radioDot: { width: 18, height: 18, borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.borderStrong, alignItems: 'center', justifyContent: 'center' },
  radioDotOn: { borderColor: color.primary },
  radioDotInner: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: color.primary },
  suggestionChip: { alignSelf: 'flex-start', marginTop: space.sm, borderWidth: 1, borderStyle: 'dashed', borderColor: color.primaryBorder, borderRadius: radius.pill, backgroundColor: color.primaryFaint, paddingHorizontal: space.md, paddingVertical: space.xs },
  suggestionChipText: { fontFamily: font.body, fontSize: fontSize.sm, color: color.primary },
  specSuggestionRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, marginTop: space.xs },

  /* specifications + documents */
  specHeaderRow: { flexDirection: 'row', gap: space.sm, marginBottom: space.xs },
  specHeaderLabel: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: 1, textTransform: 'uppercase', color: color.inkFaint },
  docChip: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderColor: color.primary, backgroundColor: color.primaryFaint, borderRadius: radius.pill, paddingLeft: space.md, paddingRight: space.sm, paddingVertical: space.xs + 2 },
  docChipLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.primary },
  emptyNote: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkFaint },
  suggestRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.xs, marginTop: space.md },
  suggestLabel: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: 1, textTransform: 'uppercase', color: color.inkFaint, marginRight: space.xs },

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
  actionButtonPrimaryHovered: {
    transform: [{ translateY: -1 }],
    ...(Platform.OS === 'web' ? ({ boxShadow: `0 6px 16px ${color.primaryBorder}` } as object) : null),
  },

  summaryBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, borderWidth: 1, borderColor: color.dangerBorder, borderRadius: radius.lg, backgroundColor: color.surface, padding: space.sm },
  summaryDot: { width: 7, height: 7, borderRadius: radius.pill, backgroundColor: color.danger, marginTop: 5 },
  summaryText: { flex: 1, fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },

  /* closing — the highest-weight field on the whole flow, its own step for emphasis */
  closingCard: { ...elevation.card, borderRadius: radius.xl, backgroundColor: color.surface, padding: space.xxl, gap: space.lg },
  closingLockBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, borderRadius: radius.md, backgroundColor: color.primaryFaint, padding: space.md },
  lockGlyph: { alignItems: 'center', marginTop: 2 },
  lockGlyphShackle: { width: 8, height: 6, borderWidth: 1.5, borderBottomWidth: 0, borderColor: color.primary, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  lockGlyphBody: { width: 12, height: 9, borderRadius: 2, backgroundColor: color.primary },
  closingLockNote: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  closingStampRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg, flexWrap: 'wrap', paddingTop: space.md, borderTopWidth: 1, borderTopColor: color.borderFaint },
  closingStampDivider: { width: 1, height: 32, backgroundColor: color.border },
  closingStampValue: { marginTop: space.xs, fontFamily: font.display, fontSize: fontSize.lg, letterSpacing: letterSpacing.tight, color: color.ink },
  closingNote: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm },

  /* review summary */
  summaryList: { gap: space.md },
  summaryLine: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, flexWrap: 'wrap', paddingBottom: space.md, borderBottomWidth: 1, borderBottomColor: color.borderFaint },
  summaryLineLabel: { width: 150, fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.inkMuted },
  summaryLineValue: { flex: 1, minWidth: 160, fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.ink },
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
