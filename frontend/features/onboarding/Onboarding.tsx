// features/onboarding/Onboarding.tsx
// One component, four states from OnboardingStep — same discriminated-union pattern as
// QuotationSubmission.tsx. IDENTITY / OPERATIONS / DOCUMENTS collect a business profile
// draft across three steps behind a shared shell: a header bar with the Trustlink mark and
// a three-segment progress indicator, a single centered form column (fields pair up at wide
// widths, stack on phone), and a fixed bottom bar carrying Back/Continue. Step changes slide
// horizontally (StepTransition, below) — forward exits left/enters from the right, Back
// reverses it. ARRIVAL is a confirmation, not a step — no shell, no progress indicator, no
// slide — shaped like the sealed quotation receipt: what was submitted, what happens next,
// and the way in.
//
// Rebuilt from docs/design/Trustlink Onboarding.dc.html, restructured to spec: city and
// province move into IDENTITY (they describe the business, not its operations), the
// welcome screen is cut, and ARRIVAL only ever renders PENDING VERIFICATION — OnboardingStep
// has no rejected / incomplete / correction variant, so this component doesn't invent one.
// Route (app/onboarding.tsx) owns the step machine and assembles the final `Business` from
// the collected drafts, the same way app/submit-quotation.tsx assembles `Quotation` from
// `QuotationDraftInput` on submit.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { View, Text, Pressable, TextInput, Image, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import ScreenScroll from '../../components/ui/ScreenScroll';
import type { LayoutChangeEvent, TextInputProps, ViewStyle } from 'react-native';
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
import type { Business, BusinessType, OnboardingStep, Attachment } from '../../lib/types';
import { NCR_CITIES, NCR_PROVINCE } from '../../lib/data/philippines';
import { OTHER_ITEM_CODE, itemsFor, useCategoryTree } from '../../lib/data/categories';
import { isWebFilePickerSupported, pickWebFile } from '../../lib/pickWebFile';
import { VALIDATION_ERROR_MARK, scrollToFirstError } from '../../lib/scrollToFirstError';

/* ─── Draft shapes ──────────────────────────────────────
 * Local to onboarding — not shared types. Assembled into a real `Business` by the route
 * only once verification documents are submitted, mirroring QuotationDraftInput. */

export interface IdentityDraft {
  registeredName: string;
  /** Optional trading name shown instead of registeredName wherever this
   *  business's name appears to someone else. Blank means registeredName
   *  is used everywhere, same as before this field existed. */
  displayName: string;
  businessType: BusinessType;
  city: string;
  province: string;
  contactPerson: string;
  contactMobile: string;
}

/** One item a seller offers — a code from GET /meta/categories, plus their
 *  own wording when the code is "other". */
export interface OfferedItemDraft {
  code: string;
  otherText: string | null;
}

export interface OperationsDraft {
  /** Asked at registration, so OPERATIONS only shows it (read-only) — accounts
   *  with none on file must pick one here. */
  category: string;
  /** Seller only, at least one. Cleared whenever the category changes. */
  offeredItems: OfferedItemDraft[];
  capabilities: string[];
  serviceAreas: string[];
  /** Optional public-facing bio, typed by the business — blank is completely normal. */
  businessDescription: string;
}

export interface DocumentsDraft {
  /** DTI certificate for a sole proprietorship, SEC certificate otherwise. */
  registrationDoc: Attachment | null;
  /** The DTI/SEC certificate number as printed on the document — validated
   *  against the backend's format check for the chosen registration type. */
  registrationIdNumber: string;
  birDoc: Attachment | null;
  /** BIR TIN in 000-000-000(-00000) form. */
  birIdNumber: string;
  /** Optional — not needed to get verified, relevant only for reaching Tier 3 sooner. */
  mayorsPermit: Attachment | null;
  mayorsPermitIdNumber: string;
}

interface IdentityProps {
  step: Extract<OnboardingStep, 'IDENTITY'>;
  initial?: Partial<IdentityDraft>;
  onContinue: (draft: IdentityDraft) => void;
  /** IDENTITY is the only step with no earlier step to go back to — this is what lets
   *  someone who opened onboarding from Home (verification is opt-in now, not forced
   *  right after registration) leave without finishing it. */
  onExit?: () => void;
}

interface OperationsProps {
  step: Extract<OnboardingStep, 'OPERATIONS'>;
  identity: IdentityDraft;
  initial?: Partial<OperationsDraft>;
  /** True for a buyer account — capabilities and service areas only drive
   *  matching sellers to requirements, so a buyer may leave them empty. */
  operationsOptional?: boolean;
  onContinue: (draft: OperationsDraft) => void;
  onBack: () => void;
  /** True when an already-verified business reached this screen from "Update
   *  profile" rather than fresh onboarding — onContinue here saves and exits
   *  straight away instead of moving on to DOCUMENTS, since editing your name
   *  or capabilities has nothing to do with re-verifying your documents. Only
   *  changes the Continue button's label; the route decides the actual behavior. */
  editMode?: boolean;
}

interface DocumentsProps {
  step: Extract<OnboardingStep, 'DOCUMENTS'>;
  identity: IdentityDraft;
  operations: OperationsDraft;
  onSubmit: (draft: DocumentsDraft) => void;
  onBack: () => void;
  /** Assistive Document Extraction (thesis Innovation & Technology) — reads
   *  the picked file and suggests the certificate/ID number. Purely a
   *  convenience: null (no suggestion) is a completely normal result, and
   *  the returned value only ever pre-fills an ordinary editable field,
   *  never submitted without the business seeing it first. Optional so this
   *  screen still works exactly as before if the route doesn't wire it up. */
  onExtractDocument?: (docType: string, file: File) => Promise<string | null>;
}

interface ArrivalProps {
  step: Extract<OnboardingStep, 'ARRIVAL'>;
  business: Business;
  documents: DocumentsDraft;
  onEnterApp: () => void;
}

export type OnboardingProps = IdentityProps | OperationsProps | DocumentsProps | ArrivalProps;

/* ─── Constants ─────────────────────────────────────── */

const BUSINESS_TYPES: { value: BusinessType; label: string }[] = [
  { value: 'SOLE_PROP', label: 'Sole proprietorship' },
  { value: 'PARTNERSHIP', label: 'Partnership' },
  { value: 'CORPORATION', label: 'Corporation' },
  { value: 'COOPERATIVE', label: 'Cooperative' },
];

function businessTypeLabel(type: BusinessType): string {
  return BUSINESS_TYPES.find((t) => t.value === type)?.label ?? type;
}

/** Capability suggestions per category — keys must match the shared CATEGORIES
 *  list (see lib/data/categories.ts) so the two never drift apart again. */
/** Placeholder examples that match the business's own category — a specialty
 *  deliberately *not* in that category's pick list (so it reads as "type your
 *  own"), and the kind of work a bio would describe. */
const EXAMPLES_BY_CATEGORY: Record<string, { customCapability: string; bioWork: string }> = {
  'Printing': { customCapability: 'Foil stamping', bioWork: 'Offset and digital printing for offices, schools and events' },
  'Packaging & Labeling': { customCapability: 'Blister packaging', bioWork: 'Custom corrugated boxes and product labels for food and retail brands' },
};
const DEFAULT_EXAMPLES = EXAMPLES_BY_CATEGORY['Printing'];

const CAPABILITIES_BY_CATEGORY: Record<string, string[]> = {
  'Printing': ['Offset printing', 'Digital printing', 'Large format printing', 'Bookbinding', 'Signage & banners', 'Screen printing'],
  'Packaging & Labeling': ['Corrugated boxes', 'Labels & stickers', 'Shrink wrap & film', 'Packaging design', 'Custom packaging', 'Pallets & crates'],
};
const CATEGORY_VISIBLE_COUNT = 4;
const OTHER_ITEM_TEXT_MAX = 100;

const CAPABILITY_MIN = 3;
const CAPABILITY_MAX = 8;

const FORM_COLUMN_MAX_WIDTH = 520;
/** Caps the scrollable form column (shellInner) so paired fields read comfortably instead
 *  of stretching edge to edge — narrower than layout.maxWidthWide, which the header/bottom
 *  bars still use for their own full-width bar treatment. */
const FORM_CONTENT_MAX_WIDTH = 680;

/** Sits under the page heading on every form step, replacing the old brand column's copy. */
const SUPPORTING_LINE = 'One profile. Verified once — a few details about your business, checked once by our team.';

/* ─── Shared helpers ────────────────────────────────── */

function listOut(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function summarizeList(items: string[], max = 4): string {
  if (items.length === 0) return '—';
  if (items.length <= max) return items.join(' · ');
  return `${items.slice(0, max).join(' · ')} · +${items.length - max} more`;
}

/** DTI registers a sole proprietorship's business name; SEC registers a partnership or
 *  corporation. A cooperative registers with the CDA in reality, but the product only asks
 *  for one of two documents here, so it is bucketed with the SEC path — the closer
 *  analogue of the two. */
function registrationDocSpec(type: BusinessType): { key: string; name: string; help: string } {
  if (type === 'SOLE_PROP') {
    return {
      key: 'DTI',
      name: 'DTI certificate of business name registration',
      help: 'The certificate issued when you registered your business name with the DTI.',
    };
  }
  return {
    key: 'SEC',
    name: 'SEC certificate of registration',
    help: 'The certificate issued when your business was registered with the SEC.',
  };
}

/** Mirrors the backend's ID_FORMAT_PATTERNS (business_service.py) so a bad
 *  number is caught here instead of silently flagging the document for
 *  admin review after submission. */
const ID_FORMAT_PATTERNS: Record<'DTI' | 'SEC' | 'BIR' | 'MAYORS_PERMIT', RegExp> = {
  DTI: /^\d{6,15}$/,
  SEC: /^[A-Za-z0-9-]{6,20}$/,
  BIR: /^\d{3}-\d{3}-\d{3}(-\d{3,5})?$/,
  MAYORS_PERMIT: /^[A-Za-z0-9\-/]{4,30}$/,
};

function isValidIdNumber(docType: keyof typeof ID_FORMAT_PATTERNS, value: string): boolean {
  return ID_FORMAT_PATTERNS[docType].test(value.trim());
}

/** Strips emoji from a free-text name field as it's typed — a business's
 *  registered name, display name, or contact person has no legitimate use
 *  for one, and it doesn't belong on a DTI/SEC/BIR-facing profile. Accented
 *  Latin letters (José, Café, Ñoño) are untouched — only pictographs, flags,
 *  and the joiner/variation-selector marks that build up combined emoji. */
function stripEmoji(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\u{200D}\u{FE0F}\u{20E3}\u{1F1E6}-\u{1F1FF}]/gu, '')
    .replace(/ {2,}/g, ' ');
}

function formatMobileDisplay(rawDigits: string): string {
  const digits = rawDigits.length === 11 && rawDigits.startsWith('0') ? rawDigits.slice(1) : rawDigits;
  return [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 10)].filter(Boolean).join(' ');
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

/** TextInput that lights its border (plus a soft ring on web) while focused —
 *  same as PostRequirement.tsx's, so both forms feel like one app. */
function FormInput({ style, onFocus, onBlur, ...props }: TextInputProps) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      placeholderTextColor={color.inkFaint}
      {...props}
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

function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

function Pill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const [hovered, hoverHandlers] = useHover();
  return (
    <Pressable
      {...hoverHandlers}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        webTransition('background-color, border-color, transform'),
        hovered && !active && styles.pillHovered,
        active ? styles.pillActive : null,
        pressed && styles.pressedScale,
      ]}
    >
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

function CheckGlyph({ tone }: { tone: string }) {
  return <View style={[styles.checkGlyph, { borderColor: tone }]} />;
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

/** One white card per group of fields, numbered — same look as PostRequirement.tsx's SectionCard. */
function FormSection({ index, heading, caption, children }: { index?: number; heading?: string; caption?: string; children: ReactNode }) {
  const { width } = useWindowDimensions();
  return (
    <View style={[styles.sectionCard, width < 480 && styles.sectionCardCompact]}>
      {!!heading && (
        <View style={styles.sectionCardHeader}>
          {index != null && (
            <View style={styles.sectionBadge}>
              <Text style={styles.sectionBadgeLabel}>{index}</Text>
            </View>
          )}
          <Text style={styles.sectionCardTitle}>{heading}</Text>
        </View>
      )}
      {!!caption && <Text style={styles.sectionCardCaption}>{caption}</Text>}
      <View style={[styles.formSection, !!heading && styles.sectionCardBody]}>{children}</View>
    </View>
  );
}

function FormDivider() {
  return <View style={styles.formDivider} />;
}

function ScreenTitle({ step, title }: { step: FormStep; title: string }) {
  const index = STEP_ORDER.indexOf(step);
  return (
    <View style={{ gap: space.xs }}>
      <Text style={styles.pageEyebrow}>
        Step {index + 1} of {STEP_ORDER.length} · {STEP_INDICATOR_LABELS[step]}
      </Text>
      <Text style={styles.pageTitle}>{title}</Text>
      <Text style={styles.pageSubtitle}>{SUPPORTING_LINE}</Text>
    </View>
  );
}

/* ─── Step indicator: three segmented progress bars, label above each ──
 * Lives in the header, beside the brand mark. Completed segments are filled, the current
 * one is filled and stronger, future ones are muted tracks — no numbers, no circles. */

type FormStep = Extract<OnboardingStep, 'IDENTITY' | 'OPERATIONS' | 'DOCUMENTS'>;
const STEP_ORDER: FormStep[] = ['IDENTITY', 'OPERATIONS', 'DOCUMENTS'];
const STEP_INDICATOR_LABELS: Record<FormStep, string> = {
  IDENTITY: 'Business',
  OPERATIONS: 'Capabilities',
  DOCUMENTS: 'Verification',
};

function SegmentedSteps({ step }: { step: FormStep }) {
  const current = STEP_ORDER.indexOf(step);
  return (
    <View style={styles.segmentedSteps}>
      {STEP_ORDER.map((s, i) => {
        const now = i === current;
        const done = i < current;
        return (
          <View key={s} style={styles.segmentedStepItem}>
            <Text
              style={[styles.segmentedStepLabel, now ? styles.segmentedStepLabelNow : done ? styles.segmentedStepLabelDone : null]}
              numberOfLines={1}
            >
              {STEP_INDICATOR_LABELS[s].toUpperCase()}
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

/* ─── Header ──────────────────────────────────────────
 * Trustlink mark and wordmark only. Full-width bar with a bottom border, matching the
 * fixed bottom bar's treatment. */

function BrandMark() {
  return (
    <View style={styles.brandMarkRow}>
      <Image source={require('../../assets/logo.jpg')} style={styles.brandMarkGlyph} resizeMode="contain" />
      <Text style={styles.brandWordmark}>Trustlink</Text>
    </View>
  );
}

/* ─── Fixed bottom bar ───────────────────────────────
 * Back (from step two onward) on the left, the segmented step indicator centred, Continue
 * on the right — three equal-flex columns so the centre stays centred regardless of
 * whether Back is present. */

function BottomBar({
  step,
  onBack,
  onExit,
  onContinue,
  continueLabel,
}: {
  step: FormStep;
  onBack?: () => void;
  onExit?: () => void;
  onContinue: () => void;
  continueLabel: string;
}) {
  return (
    <View style={styles.bottomBar}>
      <View style={styles.bottomBarInner}>
        <View style={styles.bottomBarSide}>
          {onBack ? (
            <Pressable onPress={onBack} hitSlop={6}>
              <Text style={styles.backLink}>Back</Text>
            </Pressable>
          ) : (
            onExit && (
              <Pressable onPress={onExit} hitSlop={6}>
                <Text style={styles.backLink}>Back to Home</Text>
              </Pressable>
            )
          )}
        </View>
        <View style={styles.bottomBarCenter}>
          <SegmentedSteps step={step} />
        </View>
        <View style={[styles.bottomBarSide, styles.bottomBarSideRight]}>
          <ActionButton label={continueLabel} variant="primary" onPress={onContinue} />
        </View>
      </View>
    </View>
  );
}

/* ─── IDENTITY ──────────────────────────────────────── */

function CategoryChips({ categories, category, onSelect }: { categories: string[]; category: string; onSelect: (c: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const CATEGORIES = categories;
  const selectedOutsideVisible = !!category && CATEGORIES.indexOf(category) >= CATEGORY_VISIBLE_COUNT;
  const showAll = expanded || selectedOutsideVisible;
  const shown = showAll ? CATEGORIES : CATEGORIES.slice(0, CATEGORY_VISIBLE_COUNT);
  const hiddenCount = CATEGORIES.length - CATEGORY_VISIBLE_COUNT;

  return (
    <View>
      <View style={styles.optionGrid}>
        {shown.map((c) => {
          const active = category === c;
          return (
            <View key={c} style={styles.optionGridItem}>
              <Pressable onPress={() => onSelect(c)} style={[styles.chip, active ? styles.chipActive : null]}>
                <Text style={[styles.chipLabel, active ? styles.chipLabelActive : null]}>{c}</Text>
              </Pressable>
            </View>
          );
        })}
      </View>
      {!showAll && hiddenCount > 0 && (
        <Pressable onPress={() => setExpanded(true)} style={styles.chipSeeAll}>
          <Text style={styles.chipSeeAllLabel}>See all ({hiddenCount} more)</Text>
        </Pressable>
      )}
    </View>
  );
}

function IdentityScreen({ initial, onContinue, reportContinue }: IdentityProps & { reportContinue: (fn: () => void) => void }) {
  const [registeredName, setRegisteredName] = useState(initial?.registeredName ?? '');
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '');
  const [businessType, setBusinessType] = useState<BusinessType | ''>(initial?.businessType ?? '');
  // Only an NCR city carries over — a profile saved before the pick list (e.g.
  // "Calamba") starts unselected so they choose one of the supported cities.
  const [city, setCity] = useState<string>(() => {
    const saved = initial?.city ?? '';
    return NCR_CITIES.includes(saved) ? saved : '';
  });
  const [contactPerson, setContactPerson] = useState(initial?.contactPerson ?? '');
  // Strip a leading "+63" before stripping the rest of the non-digits, so re-hydrating from
  // a previously-submitted "+63 917 555 0142" (going Back to this step) yields the 10-digit
  // "9175550142" the input expects, not "639175550142" with the country code folded in.
  const [mobileDigits, setMobileDigits] = useState(() => (initial?.contactMobile ?? '').replace(/^\+?63\s*/, '').replace(/[^0-9]/g, ''));
  const [attempted, setAttempted] = useState(false);

  const nameBad = registeredName.trim().length > 0 && registeredName.trim().length < 4;
  const mobileBad = mobileDigits.length > 0 && (mobileDigits.length < 10 || mobileDigits.length > 11);
  // Catches "12345" or "n/a" typed to get past the required-field check without
  // actually naming anyone — a contact person needs at least one letter.
  const contactPersonBad = contactPerson.trim().length > 0 && !/[a-zA-Z]/.test(contactPerson);

  const missing: string[] = [];
  if (!registeredName.trim()) missing.push('your registered business name');
  if (!businessType) missing.push('business type');
  if (!city) missing.push('city');
  if (!contactPerson.trim()) missing.push('contact person');
  if (!mobileDigits) missing.push('mobile number');

  const ready = missing.length === 0 && !nameBad && !mobileBad && !contactPersonBad;

  const handleContinue = () => {
    if (!ready || !businessType) {
      setAttempted(true);
      scrollToFirstError();
      return;
    }
    onContinue({
      registeredName: registeredName.trim(),
      displayName: displayName.trim(),
      businessType,
      city,
      province: NCR_PROVINCE,
      contactPerson: contactPerson.trim(),
      contactMobile: `+63 ${formatMobileDisplay(mobileDigits)}`,
    });
  };

  const docHint = businessType ? registrationDocSpec(businessType).key : null;

  reportContinue(handleContinue);

  return (
    <View style={styles.stepContent}>
      <ScreenTitle step="IDENTITY" title="Tell us about your business" />
      {attempted && missing.length > 0 && <SummaryBanner message={`Still needed before you continue: ${listOut(missing)}.`} />}
      <FormSection index={1} heading="About your business">
        <View style={{ gap: space.md }}>
          <View>
            <Text style={styles.fieldLabel}>Registered business name</Text>
            <Text style={styles.fieldCaption}>Exactly as it appears on your DTI or SEC certificate. We check the two against each other.</Text>
            <FormInput
              value={registeredName}
              onChangeText={(v) => setRegisteredName(stripEmoji(v))}
              placeholder="Santiago Printing and Packaging Services"
              placeholderTextColor={color.inkFaint}
              style={[styles.input, nameBad ? styles.inputError : null]}
            />
            {nameBad && <Text style={styles.errorText} {...VALIDATION_ERROR_MARK}>That looks short for a registered name — check it against the certificate.</Text>}
          </View>

          <View>
            <Text style={styles.fieldLabel}>Display name <Text style={styles.fieldOptional}>(optional)</Text></Text>
            <Text style={styles.fieldCaption}>A shorter trading name, shown instead of your registered name wherever businesses see you — requirement cards, your profile. Leave blank to just use your registered name everywhere.</Text>
            <FormInput
              value={displayName}
              onChangeText={(v) => setDisplayName(stripEmoji(v))}
              placeholder="Santiago Print Shop"
              placeholderTextColor={color.inkFaint}
              style={styles.input}
            />
          </View>

          <View>
            <View>
              <Text style={styles.fieldLabel}>Business type</Text>
              <View style={styles.optionGrid}>
                {BUSINESS_TYPES.map((t) => (
                  <View key={t.value} style={styles.optionGridItem}>
                    <Pill label={t.label} active={businessType === t.value} onPress={() => setBusinessType(t.value)} />
                  </View>
                ))}
              </View>
              {!!docHint && <Text style={styles.fieldNote}>We will ask for your {docHint} certificate and BIR registration next.</Text>}
            </View>
          </View>
        </View>
      </FormSection>

      <FormSection index={2} heading="Where you operate">
        <Text style={styles.fieldLabel}>City</Text>
        <Text style={styles.fieldCaption}>TrustLink currently covers Metro Manila — pick the city your business is based in.</Text>
        <View style={styles.pillGroupWrap}>
          {NCR_CITIES.map((c) => (
            <Pill key={c} label={c} active={city === c} onPress={() => setCity(c)} />
          ))}
        </View>
      </FormSection>

      <FormSection index={3} heading="Business contact">
        <View style={styles.twoColRow}>
          <View style={styles.twoCol}>
            <Text style={styles.fieldLabel}>Contact person</Text>
            <FormInput
              value={contactPerson}
              onChangeText={(v) => setContactPerson(stripEmoji(v))}
              placeholder="Maria Santiago"
              placeholderTextColor={color.inkFaint}
              style={[styles.input, attempted && contactPersonBad ? styles.inputError : null]}
            />
            {attempted && contactPersonBad ? (
              <Text style={styles.errorText} {...VALIDATION_ERROR_MARK}>That doesn't look like a name.</Text>
            ) : (
              // Below the input, not above — keeps this row's input aligned with Mobile
              // number's regardless of how many lines either helper text wraps to.
              <Text style={[styles.fieldCaption, { marginTop: space.xs }]}>Who the other business speaks to if you win work or award it.</Text>
            )}
          </View>

          <View style={styles.twoCol}>
            <Text style={styles.fieldLabel}>Mobile number</Text>
            <View style={[styles.input, styles.mobileFieldRow, mobileBad ? styles.inputError : null]}>
              <Text style={styles.mobilePrefix}>+63</Text>
              <FormInput
                value={mobileDigits}
                onChangeText={(v) => setMobileDigits(v.replace(/[^0-9]/g, '').slice(0, 11))}
                placeholder="917 555 0142"
                placeholderTextColor={color.inkFaint}
                keyboardType="phone-pad"
                style={styles.mobileInput}
              />
            </View>
            {mobileBad && <Text style={styles.errorText} {...VALIDATION_ERROR_MARK}>That does not look like a Philippine mobile number — 10 digits after +63.</Text>}
            <Text style={styles.quietNote}>Never shown publicly — only shared after an award.</Text>
          </View>
        </View>
      </FormSection>
    </View>
  );
}

/* ─── OPERATIONS ────────────────────────────────────── */

function OperationsScreen({ identity, initial, operationsOptional, onContinue, reportContinue }: OperationsProps & { reportContinue: (fn: () => void) => void }) {
  const { tree, categories, error: treeError } = useCategoryTree();
  const [category, setCategory] = useState(initial?.category ?? '');
  // The category from registration is shown read-only, with "Change" to open
  // the picker. An account with none on file (from before registration asked,
  // Google sign-ups) gets the picker straight away, as a required field.
  // Changing it never touches verification (business_service.submit_onboarding).
  const [pickingCategory, setPickingCategory] = useState(!initial?.category);
  const [offeredCodes, setOfferedCodes] = useState<string[]>(() => (initial?.offeredItems ?? []).map((i) => i.code));
  const [otherItemText, setOtherItemText] = useState(
    () => initial?.offeredItems?.find((i) => i.code === OTHER_ITEM_CODE)?.otherText ?? '',
  );
  const [capabilities, setCapabilities] = useState<string[]>(initial?.capabilities ?? []);
  const [capQuery, setCapQuery] = useState('');
  const [serviceAreas, setServiceAreas] = useState<string[]>(initial?.serviceAreas ?? (identity.province ? [identity.province] : []));
  const [areaInput, setAreaInput] = useState('');
  const [businessDescription, setBusinessDescription] = useState(initial?.businessDescription ?? '');
  const [attempted, setAttempted] = useState(false);

  const pool = CAPABILITIES_BY_CATEGORY[category] ?? [];
  const examples = EXAMPLES_BY_CATEGORY[category] ?? DEFAULT_EXAMPLES;
  const items = itemsFor(tree, category);
  const offersOther = offeredCodes.includes(OTHER_ITEM_CODE);

  function selectCategory(c: string) {
    // The items belong to the old category, so they go with it.
    if (c !== category) {
      setOfferedCodes([]);
      setOtherItemText('');
    }
    setCategory(c);
  }

  function toggleItem(code: string) {
    setOfferedCodes((prev) => (prev.includes(code) ? prev.filter((x) => x !== code) : [...prev, code]));
  }
  const q = capQuery.trim().toLowerCase();
  const shownCaps = q ? pool.filter((c) => c.toLowerCase().includes(q)) : pool;
  const atCap = capabilities.length >= CAPABILITY_MAX;
  // Anything selected that isn't one of the preset pills — typed in below.
  // Keeping the preset list as the primary path (rather than going pure
  // free text) matters for matching: the study's own preliminary survey
  // found businesses describe themselves in inconsistent terms, which is
  // exactly what makes a plain keyword/category match miss — a shared
  // vocabulary from the presets is what keeps that matching working today.
  // Free text still earns its place for whatever a business's specialty
  // genuinely isn't on the list (e.g. "Foil stamping" under Printing,
  // which none of the presets cover).
  const customCapabilities = capabilities.filter((c) => !pool.includes(c));
  const [customCapInput, setCustomCapInput] = useState('');

  function toggleCapability(c: string) {
    setCapabilities((prev) => {
      const has = prev.includes(c);
      if (!has && prev.length >= CAPABILITY_MAX) return prev;
      return has ? prev.filter((x) => x !== c) : [...prev, c];
    });
  }

  function addCustomCapability() {
    const v = customCapInput.trim();
    if (!v || atCap) return;
    if (capabilities.some((c) => c.toLowerCase() === v.toLowerCase())) return;
    setCapabilities((prev) => [...prev, v]);
    setCustomCapInput('');
  }

  function addArea() {
    const v = areaInput.trim();
    if (!v) return;
    setServiceAreas((prev) => (prev.includes(v) ? prev : [...prev, v]));
    setAreaInput('');
  }
  function removeArea(v: string) {
    setServiceAreas((prev) => prev.filter((x) => x !== v));
  }

  const missing: string[] = [];
  if (!category) missing.push('your business category');
  if (!operationsOptional && category) {
    if (offeredCodes.length === 0) missing.push('at least one item you offer');
    else if (offersOther && !otherItemText.trim()) missing.push('what your "Other" item is');
  }
  if (!operationsOptional) {
    if (capabilities.length < CAPABILITY_MIN) missing.push(`at least ${CAPABILITY_MIN} capabilities`);
    if (serviceAreas.length === 0) missing.push('at least one service area');
  }
  const ready = missing.length === 0;

  const handleContinue = () => {
    if (!ready) {
      setAttempted(true);
      scrollToFirstError();
      return;
    }
    onContinue({
      category,
      // A buyer isn't asked — the backend drops anything sent anyway.
      offeredItems: operationsOptional
        ? []
        : offeredCodes.map((code) => ({ code, otherText: code === OTHER_ITEM_CODE ? otherItemText.trim() : null })),
      capabilities,
      serviceAreas,
      businessDescription,
    });
  };

  reportContinue(handleContinue);

  return (
    <View style={styles.stepContent}>
      <ScreenTitle step="OPERATIONS" title="What you do, and where" />
      {attempted && missing.length > 0 && <SummaryBanner message={`Add ${listOut(missing)} first.`} />}
      <FormSection index={1} heading="What you provide">
        {!pickingCategory ? (
          <View style={styles.categoryRow}>
            <Text style={styles.categoryRowText}>
              Business category: <Text style={styles.categoryRowValue}>{category}</Text>
            </Text>
            <Pressable onPress={() => setPickingCategory(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Change business category">
              <Text style={styles.categoryChangeLink}>Change</Text>
            </Pressable>
          </View>
        ) : (
          <View style={{ marginBottom: space.lg }}>
            <Text style={styles.fieldLabel}>Business category</Text>
            <Text style={styles.fieldCaption}>
              Pick the category your business belongs to.
              {!operationsOptional && !!initial?.category ? ' Changing it clears the items you offer — pick them again below.' : ''}
            </Text>
            {treeError ? (
              <Text style={styles.errorText} {...VALIDATION_ERROR_MARK}>Couldn't load the categories — check your connection and reopen this page.</Text>
            ) : (
              <CategoryChips categories={categories} category={category} onSelect={selectCategory} />
            )}
            {attempted && !category && <Text style={styles.errorText} {...VALIDATION_ERROR_MARK}>Pick your business category.</Text>}
          </View>
        )}

        {!operationsOptional && !!category && (
          <View style={{ marginBottom: space.lg }}>
            <Text style={styles.fieldLabel}>Items you offer</Text>
            <Text style={styles.fieldCaption}>Everything in {category} you take orders for — buyers' requirements name one of these.</Text>
            <View style={styles.pillGroupWrap}>
              {items.map((item) => {
                const on = offeredCodes.includes(item.code);
                return (
                  <Pressable
                    key={item.code}
                    onPress={() => toggleItem(item.code)}
                    style={[styles.pill, on ? styles.pillActive : null]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                  >
                    <View style={styles.pillContentRow}>
                      {on && <CheckGlyph tone={color.primary} />}
                      <Text style={[styles.pillLabel, on ? styles.pillLabelActive : null]}>{item.name}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            {offersOther && (
              <FormInput
                value={otherItemText}
                onChangeText={(v) => setOtherItemText(stripEmoji(v))}
                maxLength={OTHER_ITEM_TEXT_MAX}
                placeholder="What else do you offer? e.g. Gift boxes"
                placeholderTextColor={color.inkFaint}
                style={[styles.input, attempted && !otherItemText.trim() ? styles.inputError : null]}
              />
            )}
            {attempted && offeredCodes.length === 0 && <Text style={styles.errorText} {...VALIDATION_ERROR_MARK}>Pick at least one item you offer.</Text>}
            {attempted && offersOther && !otherItemText.trim() && <Text style={styles.errorText} {...VALIDATION_ERROR_MARK}>Describe the other item you offer.</Text>}
          </View>
        )}

        <View style={styles.cardHeaderRow}>
          <Text style={styles.fieldLabel}>Capabilities</Text>
          <View style={{ flex: 1 }} />
          <Text style={[styles.capCount, capabilities.length >= CAPABILITY_MIN ? styles.capCountReady : null]}>
            {capabilities.length} of {CAPABILITY_MAX} selected
          </Text>
        </View>
        <Text style={styles.fieldCaption}>
          {operationsOptional
            ? `Optional for buyers — up to ${CAPABILITY_MAX}, shown on your profile.`
            : `Pick between ${CAPABILITY_MIN} and ${CAPABILITY_MAX}. Choosing everything you could possibly do makes your feed worse, not better.`}
        </Text>

        <FormInput
          value={capQuery}
          onChangeText={setCapQuery}
          placeholder={`Search capabilities in ${category || 'your category'}`}
          placeholderTextColor={color.inkFaint}
          style={styles.searchInput}
        />

        <View style={styles.pillGroupWrap}>
          {shownCaps.map((c) => {
            const on = capabilities.includes(c);
            const blocked = !on && atCap;
            return (
              <Pressable key={c} onPress={() => toggleCapability(c)} disabled={blocked} style={[styles.pill, on ? styles.pillActive : null, blocked ? styles.pillBlocked : null]}>
                <View style={styles.pillContentRow}>
                  {on && <CheckGlyph tone={color.primary} />}
                  <Text style={[styles.pillLabel, on ? styles.pillLabelActive : null]}>{c}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
        {q.length > 0 && shownCaps.length === 0 && (
          <Text style={styles.fieldNote}>Nothing in {category} matches "{capQuery}". Try a broader word.</Text>
        )}

        {customCapabilities.length > 0 && (
          <View style={[styles.pillGroupWrap, { marginTop: space.sm }]}>
            {customCapabilities.map((c) => (
              <Pressable key={c} onPress={() => toggleCapability(c)} style={[styles.pill, styles.pillActive]}>
                <View style={styles.pillContentRow}>
                  <CheckGlyph tone={color.primary} />
                  <Text style={[styles.pillLabel, styles.pillLabelActive]}>{c}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}
        <Text style={[styles.fieldCaption, { marginTop: space.sm }]}>Specialty not on the list? Type your own.</Text>
        <View style={styles.addAreaRow}>
          <FormInput
            value={customCapInput}
            onChangeText={(v) => setCustomCapInput(stripEmoji(v))}
            onSubmitEditing={addCustomCapability}
            editable={!atCap}
            placeholder={atCap ? `${CAPABILITY_MAX} selected already` : `e.g. ${examples.customCapability}`}
            placeholderTextColor={color.inkFaint}
            style={[styles.input, { flex: 1, marginTop: 0 }]}
          />
          <ActionButton label="Add" variant="outline" onPress={addCustomCapability} />
        </View>
      </FormSection>

      <FormSection index={2} heading="Where you work">
        <Text style={styles.fieldLabel}>Service areas</Text>
        <Text style={styles.fieldCaption}>Cities you would travel to for work. Pre-filled from where you are based.</Text>

        <View style={styles.pillGroupWrap}>
          {serviceAreas.map((a) => (
            <Pressable key={a} onPress={() => removeArea(a)} style={[styles.pill, styles.pillActive]}>
              <View style={styles.pillContentRow}>
                <CheckGlyph tone={color.primary} />
                <Text style={[styles.pillLabel, styles.pillLabelActive]}>{a}</Text>
              </View>
            </Pressable>
          ))}
        </View>

        <View style={styles.addAreaRow}>
          <FormInput
            value={areaInput}
            onChangeText={(v) => setAreaInput(stripEmoji(v))}
            onSubmitEditing={addArea}
            placeholder="Add a city, e.g. Pasig"
            placeholderTextColor={color.inkFaint}
            style={[styles.input, { flex: 1, marginTop: 0 }]}
          />
          <ActionButton label="Add" variant="outline" onPress={addArea} />
        </View>
      </FormSection>

      <FormSection index={3} heading="About your business">
        <View style={styles.cardHeaderRow}>
          <Text style={styles.fieldLabel}>Bio</Text>
          <View style={{ flex: 1 }} />
          <View style={[styles.tag, styles.tagOptional]}>
            <Text style={[styles.tagLabel, styles.tagLabelOptional]}>Optional</Text>
          </View>
        </View>
        <Text style={styles.fieldCaption}>Shown on your public profile. A sentence or two about what you do and where you work.</Text>
        <FormInput
          value={businessDescription}
          onChangeText={setBusinessDescription}
          multiline
          numberOfLines={3}
          maxLength={500}
          placeholder={`e.g. ${examples.bioWork} in ${identity.city || 'Quezon City'} and nearby Metro Manila cities.`}
          placeholderTextColor={color.inkFaint}
          style={styles.textareaLarge}
        />
      </FormSection>
    </View>
  );
}

/* ─── DOCUMENTS ─────────────────────────────────────── */

/** Real file bytes never fit in `Attachment` (id/filename/sizeBytes/mimeType/uri only —
 *  shared with the rest of the app, so it isn't the place to add a `File` field). On web,
 *  `capture()` below opens a real <input type="file"> and stashes the picked File here,
 *  keyed by the Attachment id it generated, so app/onboarding.tsx can find the actual
 *  bytes to upload after DOCUMENTS submits. Native builds still fall back to the fake
 *  metadata further down — wiring expo-document-picker is a separate follow-up. */
export const pickedDocumentFiles = new Map<string, File>();

function DocumentUploadRow({
  name,
  help,
  required,
  file,
  onCapture,
  onRemove,
  idNumberLabel,
  idNumberPlaceholder,
  idNumber,
  onIdNumberChange,
  idNumberBad,
  attempted,
  extractionStatus,
}: {
  name: string;
  help: string;
  required: boolean;
  file: Attachment | null;
  onCapture: () => void;
  onRemove: () => void;
  idNumberLabel: string;
  idNumberPlaceholder: string;
  idNumber: string;
  onIdNumberChange: (value: string) => void;
  idNumberBad: boolean;
  attempted: boolean;
  /** Assistive Document Extraction's outcome for this document, if any —
   *  purely informational, the field itself is always a normal editable
   *  TextInput regardless of what this says. */
  extractionStatus?: 'reading' | 'found' | 'not_found';
}) {
  return (
    <View>
      <View style={styles.cardHeaderRow}>
        <Text style={styles.fieldLabel}>{name}</Text>
        <View style={[styles.tag, required ? styles.tagRequired : styles.tagOptional]}>
          <Text style={[styles.tagLabel, required ? styles.tagLabelRequired : styles.tagLabelOptional]}>{required ? 'Required' : 'Optional'}</Text>
        </View>
      </View>
      <Text style={styles.fieldCaption}>{help}</Text>

      {file ? (
        <View style={styles.docFileCard}>
          <View style={styles.docFileIcon} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.docFileName} numberOfLines={1}>{file.filename}</Text>
            <Text style={styles.docFileMeta}>Photo · {(file.sizeBytes / 1_000_000).toFixed(1)} MB · added just now</Text>
          </View>
          <Pressable onPress={onRemove} style={styles.docFileRemove} hitSlop={8}>
            <XGlyph tone={color.inkFaint} />
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={onCapture} style={styles.docAddButton}>
          <Text style={styles.docAddButtonLabel}>+ Add a photo or file</Text>
        </Pressable>
      )}

      {file && (
        <View style={{ marginTop: space.sm }}>
          <Text style={styles.fieldLabel}>{idNumberLabel}</Text>
          <FormInput
            value={idNumber}
            onChangeText={onIdNumberChange}
            placeholder={idNumberPlaceholder}
            placeholderTextColor={color.inkFaint}
            autoCapitalize="characters"
            style={[styles.input, attempted && idNumberBad ? styles.inputError : null]}
          />
          {extractionStatus === 'reading' && <Text style={styles.fieldCaption}>Reading your document…</Text>}
          {extractionStatus === 'found' && (
            <Text style={styles.fieldCaption}>Suggested from your document — check it against the original.</Text>
          )}
          {extractionStatus === 'not_found' && (
            <Text style={styles.fieldCaption}>Couldn't find a number on that document — enter it yourself below.</Text>
          )}
          {attempted && idNumberBad && (
            <Text style={styles.errorText} {...VALIDATION_ERROR_MARK}>That doesn't look like a valid {idNumberLabel.toLowerCase()} — check it against the document.</Text>
          )}
        </View>
      )}
    </View>
  );
}

function DocumentsScreen({ identity, onSubmit, reportContinue, onExtractDocument }: DocumentsProps & { reportContinue: (fn: () => void) => void }) {
  const regSpec = registrationDocSpec(identity.businessType);
  const [registrationDoc, setRegistrationDoc] = useState<Attachment | null>(null);
  const [registrationIdNumber, setRegistrationIdNumber] = useState('');
  const [birDoc, setBirDoc] = useState<Attachment | null>(null);
  const [birIdNumber, setBirIdNumber] = useState('');
  const [mayorsPermit, setMayorsPermit] = useState<Attachment | null>(null);
  const [mayorsPermitIdNumber, setMayorsPermitIdNumber] = useState('');
  const [attempted, setAttempted] = useState(false);

  // Assistive Document Extraction UI state — what happened the last time each
  // slot was read, purely for the caption under that field; doesn't gate
  // anything, the fields stay normal editable TextInputs regardless.
  type DocKind = 'registration' | 'bir' | 'permit';
  type ExtractionStatus = 'reading' | 'found' | 'not_found';
  const [extractionStatus, setExtractionStatus] = useState<Partial<Record<DocKind, ExtractionStatus>>>({});

  function applyPicked(kind: 'registration' | 'bir' | 'permit', file: Attachment) {
    if (kind === 'registration') setRegistrationDoc(file);
    else if (kind === 'bir') setBirDoc(file);
    else setMayorsPermit(file);
  }

  async function runExtraction(kind: DocKind, docType: string, picked: File) {
    if (!onExtractDocument) return;
    setExtractionStatus((prev) => ({ ...prev, [kind]: 'reading' }));
    try {
      const suggestion = await onExtractDocument(docType, picked);
      if (!suggestion) {
        setExtractionStatus((prev) => ({ ...prev, [kind]: 'not_found' }));
        return;
      }
      const setValue = kind === 'registration' ? setRegistrationIdNumber : kind === 'bir' ? setBirIdNumber : setMayorsPermitIdNumber;
      // Functional form, not a closed-over value — the extraction request can
      // take a couple seconds, and if the business typed something into the
      // field themselves while it was in flight, this must see THAT, not a
      // stale snapshot from when the request started. Only ever fills a field
      // that's still blank by the time the suggestion actually lands.
      let applied = false;
      setValue((current) => {
        if (current.trim()) return current;
        applied = true;
        return suggestion;
      });
      // If the field already had text by the time the suggestion landed, the
      // business typed it themselves — leave their caption alone rather than
      // reporting an outcome about a value they didn't ask for.
      if (applied) {
        setExtractionStatus((prev) => ({ ...prev, [kind]: 'found' }));
      } else {
        setExtractionStatus((prev) => {
          const next = { ...prev };
          delete next[kind];
          return next;
        });
      }
    } catch {
      setExtractionStatus((prev) => ({ ...prev, [kind]: 'not_found' }));
    }
  }

  async function capture(kind: 'registration' | 'bir' | 'permit') {
    const tag = kind === 'registration' ? regSpec.key : kind === 'bir' ? 'BIR' : 'PERMIT';
    const docType = kind === 'registration' ? regSpec.key : kind === 'bir' ? 'BIR' : 'MAYORS_PERMIT';

    // Web: open a real file picker so there's an actual Blob to upload later.
    if (isWebFilePickerSupported()) {
      const picked = await pickWebFile('image/*,application/pdf');
      if (!picked) return; // dialog closed without picking — do nothing, same as before
      const id = `doc-${kind}-${Date.now()}`;
      pickedDocumentFiles.set(id, picked);
      applyPicked(kind, {
        id,
        filename: picked.name || `${tag}.jpg`,
        sizeBytes: picked.size,
        mimeType: picked.type,
        uri: '',
        documentLabel: null,
      });
      void runExtraction(kind, docType, picked);
      return;
    }

    // Native fallback — placeholder metadata only, no real bytes. Replace with
    // expo-document-picker / expo-image-picker when a native build is targeted.
    applyPicked(kind, {
      id: `doc-${kind}-${Date.now()}`,
      filename: `IMG_${Date.now()}_${tag}.jpg`,
      sizeBytes: 2_400_000,
      mimeType: 'image/jpeg',
      uri: '',
      documentLabel: null,
    });
  }

  const registrationIdBad = !isValidIdNumber(regSpec.key as 'DTI' | 'SEC', registrationIdNumber);
  const birIdBad = !isValidIdNumber('BIR', birIdNumber);
  const mayorsPermitIdBad = !!mayorsPermit && !isValidIdNumber('MAYORS_PERMIT', mayorsPermitIdNumber);

  const missing: string[] = [];
  if (!registrationDoc) missing.push(`your ${regSpec.key} certificate`);
  else if (registrationIdBad) missing.push(`a valid ${regSpec.key} certificate number`);
  if (!birDoc) missing.push('your BIR registration');
  else if (birIdBad) missing.push('a valid BIR TIN');
  if (mayorsPermitIdBad) missing.push("a valid Mayor's permit number");
  const ready = missing.length === 0;

  const handleSubmit = () => {
    if (!ready) {
      setAttempted(true);
      scrollToFirstError();
      return;
    }
    onSubmit({ registrationDoc, registrationIdNumber, birDoc, birIdNumber, mayorsPermit, mayorsPermitIdNumber });
  };

  reportContinue(handleSubmit);

  return (
    <View style={styles.stepContent}>
      <ScreenTitle step="DOCUMENTS" title="Verify your business" />
      {attempted && missing.length > 0 && <SummaryBanner message={`Add ${listOut(missing)} to submit.`} />}
      <FormSection index={1} heading="Documents">
        <View style={{ gap: space.lg }}>
          <DocumentUploadRow
            name={regSpec.name}
            help={regSpec.help}
            required
            file={registrationDoc}
            onCapture={() => capture('registration')}
            onRemove={() => setRegistrationDoc(null)}
            idNumberLabel={`${regSpec.key} certificate number`}
            idNumberPlaceholder={regSpec.key === 'DTI' ? '1234567890' : 'CS201912345'}
            idNumber={registrationIdNumber}
            onIdNumberChange={setRegistrationIdNumber}
            idNumberBad={registrationIdBad}
            attempted={attempted}
            extractionStatus={extractionStatus.registration}
          />
          <FormDivider />
          <DocumentUploadRow
            name="BIR certificate of registration"
            help="Form 2303. Enter your TIN exactly as printed."
            required
            file={birDoc}
            onCapture={() => capture('bir')}
            onRemove={() => setBirDoc(null)}
            idNumberLabel="TIN"
            idNumberPlaceholder="123-456-789"
            idNumber={birIdNumber}
            onIdNumberChange={setBirIdNumber}
            idNumberBad={birIdBad}
            attempted={attempted}
            extractionStatus={extractionStatus.bir}
          />
          <FormDivider />
          <DocumentUploadRow
            name="Mayor's permit"
            help="Not needed to get verified. Businesses that add it later can reach Tier 3 sooner."
            required={false}
            file={mayorsPermit}
            onCapture={() => capture('permit')}
            onRemove={() => setMayorsPermit(null)}
            idNumberLabel="Permit number"
            idNumberPlaceholder="BP-2024-001234"
            idNumber={mayorsPermitIdNumber}
            onIdNumberChange={setMayorsPermitIdNumber}
            idNumberBad={mayorsPermitIdBad}
            attempted={attempted}
            extractionStatus={extractionStatus.permit}
          />
        </View>
      </FormSection>

      <Text style={styles.quietNote}>
        Your documents are seen by the Trustlink team who check them, and by nobody else. They are never shown on your profile — only the fact that you were verified, and the date.
      </Text>
    </View>
  );
}

/* ─── ARRIVAL ───────────────────────────────────────── */

function ClockGlyph() {
  return (
    <View style={styles.clockRing}>
      <View style={styles.clockHandMinute} />
      <View style={styles.clockHandHour} />
    </View>
  );
}

interface ArrivalTimelineStep {
  title: string;
  when: string;
  body: string;
  done: boolean;
}

function ArrivalScreen({ business, documents, onEnterApp }: ArrivalProps) {
  const regSpec = registrationDocSpec(business.businessType);
  const docNames = [`${regSpec.key} certificate`, 'BIR certificate'];
  if (documents.mayorsPermit) docNames.push("Mayor's permit");
  const docsLine = `${listOut(docNames)} · submitted just now`;

  const timeline: ArrivalTimelineStep[] = [
    { title: 'Documents submitted', when: 'Just now', done: true, body: 'Both are with the Trustlink team. You do not need to do anything else.' },
    { title: 'We check them', when: 'Within 1 working day', done: false, body: `Against ${regSpec.key} and BIR records. If something cannot be read or does not match, we tell you exactly what to replace.` },
    { title: 'Verified', when: 'After the check', done: false, body: 'Your profile gains the verified badge and its date, and posting and quoting open. Trust tier is separate — it comes from requirements awarded to you.' },
  ];

  return (
    <ScreenScroll style={styles.root} contentContainerStyle={styles.arrivalScrollContent}>
      <View style={styles.arrivalPage}>
        <View style={styles.arrivalHero}>
          <View style={styles.arrivalIconCircle}>
            <ClockGlyph />
          </View>
          <View style={styles.arrivalPill}>
            <Text style={styles.arrivalPillLabel}>Pending verification</Text>
          </View>
          <Text style={styles.arrivalTitle}>You are in — we are checking your documents</Text>
          <Text style={styles.arrivalBody}>
            Browse requirements now. Posting a requirement and submitting a quotation open as soon as your documents are checked — usually within one working day.
          </Text>
        </View>

        <View style={styles.card}>
          <SectionLabel>What you submitted</SectionLabel>
          <View style={styles.arrivalIdentityRow}>
            <View style={styles.arrivalAvatar}>
              <Text style={styles.arrivalAvatarLabel}>
                {(business.displayName ?? business.registeredName)
                  .split(' ')
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((w) => w[0])
                  .join('')
                  .toUpperCase()}
              </Text>
            </View>
            <View style={{ minWidth: 0, flex: 1 }}>
              <Text style={styles.arrivalBusinessName}>{business.displayName ?? business.registeredName}</Text>
              <Text style={styles.arrivalBusinessMeta}>{businessTypeLabel(business.businessType)} · {business.category}</Text>
            </View>
          </View>

          <View style={styles.arrivalFactsGrid}>
            <View style={styles.arrivalFactRow}>
              <SectionLabel>Based in</SectionLabel>
              <Text style={styles.arrivalFactValue}>{business.city}, {business.province}</Text>
            </View>
            <View style={styles.arrivalFactRow}>
              <SectionLabel>Capabilities</SectionLabel>
              <Text style={styles.arrivalFactValue}>{summarizeList(business.capabilities)}</Text>
            </View>
            <View style={styles.arrivalFactRow}>
              <SectionLabel>Service area</SectionLabel>
              <Text style={styles.arrivalFactValue}>{summarizeList(business.serviceAreas)}</Text>
            </View>
            <View style={styles.arrivalFactRow}>
              <SectionLabel>Contact</SectionLabel>
              <Text style={styles.arrivalFactValue}>{business.contactPerson} · {business.contactMobile}</Text>
            </View>
            <View style={styles.arrivalFactRow}>
              <SectionLabel>Documents</SectionLabel>
              <Text style={styles.arrivalFactValue}>{docsLine}</Text>
            </View>
          </View>

          <View style={styles.arrivalDisclaimerRow}>
            <Text style={styles.arrivalDisclaimer}>
              The verified badge and your trust tier are not part of this record. Verification is a check we carry out; tier is earned from requirements awarded to you. Neither comes from completing this form.
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <SectionLabel>What happens next</SectionLabel>
          <View style={{ marginTop: space.sm }}>
            {timeline.map((t, i) => {
              const last = i === timeline.length - 1;
              return (
                <View key={t.title} style={styles.timelineRow}>
                  <View style={styles.timelineRail}>
                    <View style={[styles.timelineDot, t.done ? styles.timelineDotDone : null]} />
                    {!last && <View style={styles.timelineLine} />}
                  </View>
                  <View style={[styles.timelineContent, !last ? { paddingBottom: space.xl } : null]}>
                    <View style={styles.timelineHeaderRow}>
                      <Text style={[styles.timelineTitle, t.done ? styles.timelineTitleDone : null]}>{t.title}</Text>
                      <Text style={styles.timelineWhen}>{t.when}</Text>
                    </View>
                    <Text style={styles.timelineBody}>{t.body}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        <View style={styles.footerRow}>
          <ActionButton label="See requirements for you" variant="primary" onPress={onEnterApp} />
        </View>
      </View>
    </ScreenScroll>
  );
}

/* ─── Step transition: horizontal slide + cross-fade ─────
 * Wraps only the step's content (title + fields) inside shellInner — the header and the
 * fixed bottom bar are rendered once by the root component, outside this wrapper, so they
 * never move during the transition.
 *
 * Forward (higher STEP_ORDER index): outgoing exits left, incoming enters from the right.
 * Back: reversed. Both layers also cross-fade opacity alongside the slide (outgoing 1→0,
 * incoming 0→1) on the same ease-in-out timing, so the swap reads as one continuous motion
 * rather than a hard cut. Only the just-left step's most recent render is kept as a static,
 * non-interactive "outgoing" layer while it animates out — IdentityScreen, OperationsScreen,
 * and DocumentsScreen all re-seed their local field state from the `initial`/route-held
 * draft, so a remounted outgoing snapshot still shows the just-submitted values, never a
 * blank form. */

const STEP_TRANSITION_MS = 320;
const STEP_TRANSITION_EASING = Easing.inOut(Easing.cubic);

function StepTransition({ step, children }: { step: FormStep; children: ReactNode }) {
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
      const dir = newOrder > prevOrder ? 1 : -1; // 1 = forward, -1 = back
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
 * Renders the persistent shell (header, scroll area, fixed bottom bar) once — it's the
 * same `Onboarding` instance across every step change, since app/onboarding.tsx always
 * renders this same component with a new `step` prop rather than swapping components. Only
 * StepTransition's children (the active screen's title + fields) get swapped and animated;
 * Continue's actual handler lives inside whichever screen is mounted, so it's exposed to
 * the persistent bottom bar via `reportContinue`, called during that screen's render to
 * keep a ref up to date — Back and the Continue label don't need this, since both are
 * derivable directly from `props` here. */

export default function Onboarding(props: OnboardingProps) {
  const continueRef = useRef<() => void>(() => {});
  const reportContinue = (fn: () => void) => {
    continueRef.current = fn;
  };

  if (props.step === 'ARRIVAL') {
    return <ArrivalScreen {...props} />;
  }

  let content: ReactNode;
  switch (props.step) {
    case 'IDENTITY':
      content = <IdentityScreen {...props} reportContinue={reportContinue} />;
      break;
    case 'OPERATIONS':
      content = <OperationsScreen {...props} reportContinue={reportContinue} />;
      break;
    case 'DOCUMENTS':
      content = <DocumentsScreen {...props} reportContinue={reportContinue} />;
      break;
  }

  const onBack = 'onBack' in props ? props.onBack : undefined;
  const onExit = 'onExit' in props ? props.onExit : undefined;
  const continueLabel =
    props.step === 'DOCUMENTS'
      ? 'Submit for verification'
      : props.step === 'OPERATIONS' && props.editMode
      ? 'Save changes'
      : 'Continue';

  return (
    <View style={styles.root}>
      <View style={styles.shellHeader}>
        <BrandMark />
      </View>

      <ScreenScroll style={styles.shellScroll} contentContainerStyle={styles.shellScrollContent}>
        <View style={styles.shellInner}>
          <StepTransition step={props.step}>{content}</StepTransition>
        </View>
      </ScreenScroll>

      <BottomBar
        step={props.step}
        onBack={onBack}
        onExit={onExit}
        onContinue={() => continueRef.current()}
        continueLabel={continueLabel}
      />
    </View>
  );
}

/* ─── Styles ─────────────────────────────────────────── */

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.surfaceSunken },

  /* top header — mark + wordmark only, far left of the viewport. Full-width bar with a
   * bottom border, matching the fixed bottom bar's treatment (not capped to the form). */
  shellHeader: {
    width: '100%',
    paddingHorizontal: layout.screenPadding,
    paddingVertical: space.lg,
    backgroundColor: color.canvas,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },

  /* scrollable form — capped narrower than the header/bottom bars so paired fields read
   * comfortably instead of stretching edge to edge. Generous paddingTop so the heading
   * doesn't sit flush against the header bar. */
  shellScroll: { flex: 1 },
  shellScrollContent: { alignItems: 'center' },
  shellInner: {
    width: '100%',
    maxWidth: FORM_CONTENT_MAX_WIDTH,
    paddingHorizontal: layout.screenPadding,
    paddingTop: space.xxxl,
    paddingBottom: space.xxxl,
  },

  /* fixed bottom bar — Back left, segmented steps centred, Continue right. Three equal
   * flex columns keep the centre truly centred whether or not Back is present. */
  bottomBar: { width: '100%', alignItems: 'center', backgroundColor: color.canvas, borderTopWidth: 1, borderTopColor: color.border },
  bottomBarInner: {
    width: '100%',
    maxWidth: layout.maxWidthWide,
    paddingHorizontal: layout.screenPadding,
    paddingVertical: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  bottomBarSide: { flex: 1, minWidth: 0, justifyContent: 'center' },
  bottomBarSideRight: { alignItems: 'flex-end' },
  bottomBarCenter: { flex: 1, alignItems: 'center', minWidth: 0 },

  arrivalScrollContent: { alignItems: 'center', paddingBottom: space.xxl },
  arrivalPage: { width: '100%', maxWidth: FORM_COLUMN_MAX_WIDTH, paddingHorizontal: layout.screenPadding, paddingTop: space.xxl, gap: space.lg },

  pageEyebrow: { fontFamily: font.monoMedium, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.primary },
  pageTitle: { fontFamily: font.display, fontSize: fontSize.xl, lineHeight: lineHeight.xl, letterSpacing: letterSpacing.tight, color: color.ink },
  pageSubtitle: { maxWidth: 480, fontFamily: font.body, fontSize: fontSize.base, lineHeight: lineHeight.base, color: color.inkMuted },

  /* header content */
  brandMarkRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  brandMarkGlyph: { width: 24, height: 24, borderRadius: radius.pill },
  brandWordmark: { fontFamily: font.display, fontSize: fontSize.base, color: color.ink },

  /* segmented step indicator — three progress bars, label above each. Completed and
   * current are filled; current is the stronger fill; future is a bare muted track. Sized
   * for the bottom bar's centre column, not stretched to fill it. */
  segmentedSteps: { flexDirection: 'row', alignItems: 'flex-start', gap: space.lg, width: '100%', maxWidth: 440 },
  // minWidth is a floor, not a fixed size — flex: 1 still splits the row evenly
  // on wide screens. 84 was too high: 3 items + 2 gaps at space.lg (16) needs
  // 284px, which just barely clips on the smallest phones (320px wide leaves
  // only 280px after the 20px screen padding on each side). 76 keeps the same
  // total comfortably under that.
  segmentedStepItem: { flex: 1, minWidth: 76, gap: space.xs },
  segmentedStepLabel: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, color: color.inkFaint },
  segmentedStepLabelNow: { fontFamily: font.monoMedium, color: color.ink },
  segmentedStepLabelDone: { color: color.inkMuted },
  segmentedStepTrack: { height: 4, borderRadius: radius.pill, backgroundColor: color.border, overflow: 'hidden' },
  segmentedStepFill: { height: '100%', width: '100%', borderRadius: radius.pill, backgroundColor: color.primaryBorder },
  segmentedStepFillNow: { backgroundColor: color.primary },

  /* step transition — horizontal slide between IDENTITY/OPERATIONS/DOCUMENTS */
  // Sized by the in-flow incoming layer's own content (no flex:1 — this sits inside a
  // ScrollView now, not a fixed-height screen), with the outgoing layer absolutely
  // positioned over it so it doesn't affect that height while it slides away.
  stepTransitionWrap: { width: '100%', position: 'relative', overflow: 'hidden' },
  stepTransitionLayer: { width: '100%' },
  stepTransitionGhost: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },

  // The gap between the screen title and its first field group, and between each field
  // group after — every screen's content wraps in this instead of FormShell providing it.
  stepContent: { gap: space.lg },

  /* "what brought you here" — keeps its original weight, unlike the plain sections below */

  /* plain field groups: headings + dividers, no nested cards */
  formSection: { gap: space.sm },
  sectionCard: { ...elevation.card, borderRadius: radius.xl, backgroundColor: color.surface, padding: space.xxl },
  sectionCardCompact: { padding: space.lg },
  sectionCardHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  sectionBadge: { width: 24, height: 24, borderRadius: radius.pill, backgroundColor: color.primaryFaint, alignItems: 'center', justifyContent: 'center' },
  sectionBadgeLabel: { fontFamily: font.monoMedium, fontSize: fontSize.micro, color: color.primary },
  sectionCardTitle: { flex: 1, fontFamily: font.display, fontSize: fontSize.md, letterSpacing: letterSpacing.tight, color: color.ink },
  sectionCardCaption: { marginTop: space.xs, fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  sectionCardBody: { marginTop: space.lg },
  inputFocused: {
    borderColor: color.primary,
    backgroundColor: color.surface,
    ...(Platform.OS === 'web' ? ({ boxShadow: `0 0 0 3px ${color.primaryFaint}`, outlineStyle: 'none' } as object) : null),
  },
  formDivider: { height: 1, backgroundColor: color.borderFaint },

  sectionLabel: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.inkFaint },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, flexWrap: 'wrap' },
  fieldLabel: { fontFamily: font.bodySemi, fontSize: fontSize.base, color: color.ink },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md, marginBottom: space.lg },
  categoryChangeLink: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.primary, textDecorationLine: 'underline' },
  categoryRowText: { fontFamily: font.body, fontSize: fontSize.base, color: color.inkMuted },
  categoryRowValue: { fontFamily: font.bodySemi, color: color.ink },
  fieldCaption: { marginTop: 2, fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  fieldOptional: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkFaint },
  fieldNote: { marginTop: space.xs, fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  errorText: { marginTop: space.xs, fontFamily: font.body, fontSize: fontSize.sm, color: color.danger },
  quietNote: { marginTop: space.xs, fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkFaint },

  input: { marginTop: space.xs, minHeight: layout.minTouchTarget, backgroundColor: color.canvas, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.sm, fontFamily: font.body, fontSize: fontSize.base, color: color.ink },
  textareaLarge: { marginTop: space.xs, backgroundColor: color.canvas, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.sm, fontFamily: font.body, fontSize: fontSize.base, color: color.ink, minHeight: 80, textAlignVertical: 'top' },
  inputError: { borderColor: color.dangerBorder },

  twoColRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
  twoCol: { flexGrow: 1, flexBasis: 200, minWidth: 160 },

  // Reuses styles.input's exact box model (border, radius, background, padding) via style
  // array composition — this row is that same field treatment, not a near-duplicate.
  mobileFieldRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  // Same font as mobileInput/every other field — the previous font.mono on the prefix vs
  // font.body on the typed digits gave the two a different baseline/x-height, which is
  // what actually read as "sits inside it differently" next to plain single-font inputs.
  mobilePrefix: { fontFamily: font.body, fontSize: fontSize.base, lineHeight: lineHeight.base, color: color.inkFaint },
  mobileInput: { flex: 1, minWidth: 0, fontFamily: font.body, fontSize: fontSize.base, lineHeight: lineHeight.base, color: color.ink },

  searchInput: { marginTop: space.sm, borderWidth: 1, borderColor: color.border, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.sm, fontFamily: font.body, fontSize: fontSize.sm, color: color.ink, backgroundColor: color.surfaceSunken },

  /* pills (business type, capabilities, service areas) — natural tag-wrap by default;
   * business type additionally uses optionGrid/optionGridItem below for an even layout */
  pillGroupWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.sm },
  pill: { borderWidth: 1, borderColor: color.border, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.xs + 2, alignItems: 'center', justifyContent: 'center' },
  pillHovered: { borderColor: color.borderStrong, backgroundColor: color.surface },
  pillActive: { backgroundColor: color.primaryFaint, borderColor: color.primary },
  pressedScale: { transform: [{ scale: 0.97 }] },
  pillBlocked: { opacity: 0.45 },
  pillContentRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  pillLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.inkMuted, textAlign: 'center' },
  pillLabelActive: { color: color.primary },

  /* compact category chips — grid via optionGrid/optionGridItem below; "see all" sits
   * outside the grid so it never disrupts the column widths */
  chip: { borderWidth: 1, borderColor: color.border, borderRadius: radius.md, paddingHorizontal: space.sm, paddingVertical: 6, alignItems: 'center', justifyContent: 'center' },
  chipActive: { backgroundColor: color.primaryFaint, borderColor: color.primary },
  chipLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.inkMuted, textAlign: 'center' },
  chipLabelActive: { color: color.primary },
  chipSeeAll: { alignSelf: 'flex-start', marginTop: space.sm, justifyContent: 'center', paddingHorizontal: space.sm, paddingVertical: 6 },
  chipSeeAllLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.primary, textDecorationLine: 'underline' },

  /* even grid — business type and industry category both use this instead of natural
   * tag-wrap, so chips line up in fixed-width columns rather than fragmenting unevenly. */
  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.sm },
  optionGridItem: { flexBasis: '48%', flexGrow: 0, flexShrink: 0 },


  /* capability count */
  capCount: { fontFamily: font.mono, fontSize: fontSize.micro, color: color.inkFaint },
  capCountReady: { color: color.primary },

  /* add service area */
  addAreaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm },

  /* summary / error banner */
  summaryBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, borderWidth: 1, borderColor: color.dangerBorder, borderRadius: radius.lg, backgroundColor: color.surface, padding: space.sm },
  summaryDot: { width: 7, height: 7, borderRadius: radius.pill, backgroundColor: color.danger, marginTop: 5 },
  summaryText: { flex: 1, fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },

  /* footer / actions */
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  backLink: { fontFamily: font.bodyMedium, fontSize: fontSize.base, color: color.inkMuted },
  actionButton: { minHeight: layout.minTouchTarget, borderRadius: radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },
  actionButtonLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm },
  actionButtonPrimaryHovered: {
    transform: [{ translateY: -1 }],
    ...(Platform.OS === 'web' ? ({ boxShadow: `0 6px 16px ${color.primaryBorder}` } as object) : null),
  },

  /* documents */
  tag: { borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: space.sm, paddingVertical: 2 },
  tagRequired: { borderColor: color.primaryBorder },
  tagOptional: { borderColor: color.border },
  tagLabel: { fontFamily: font.mono, fontSize: 9, letterSpacing: letterSpacing.label, textTransform: 'uppercase' },
  tagLabelRequired: { color: color.primary },
  tagLabelOptional: { color: color.inkFaint },
  docAddButton: { marginTop: space.sm, alignSelf: 'flex-start', borderWidth: 1, borderStyle: 'dashed', borderColor: color.primaryBorder, backgroundColor: color.primaryFaint, borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.sm },
  docAddButtonLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.primary },
  docFileCard: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, padding: space.sm },
  docFileIcon: { width: 32, height: 32, borderRadius: radius.md, backgroundColor: color.surfaceSunken },
  docFileName: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.ink },
  docFileMeta: { marginTop: 2, fontFamily: font.mono, fontSize: 10, color: color.inkFaint },
  docFileRemove: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },

  /* x / check glyphs */
  xGlyph: { width: 12, height: 12, alignItems: 'center', justifyContent: 'center' },
  xGlyphBar: { position: 'absolute', width: 10, height: 1.4, borderRadius: 1 },
  checkGlyph: { width: 8, height: 5, borderLeftWidth: 1.6, borderBottomWidth: 1.6, transform: [{ rotate: '-45deg' }] },

  /* arrival — not a step, kept as its own centered flow, lighter padding for consistency */
  card: { ...elevation.cardRaised, borderRadius: radius.xl, backgroundColor: color.surface, padding: space.md, gap: space.sm },

  arrivalHero: { alignItems: 'center', gap: space.sm, textAlign: 'center' } as ViewStyle,
  arrivalIconCircle: { width: 62, height: 62, borderRadius: radius.pill, backgroundColor: color.primaryFaint, alignItems: 'center', justifyContent: 'center' },
  clockRing: { width: 26, height: 26, borderRadius: radius.pill, borderWidth: 2, borderColor: color.primary, alignItems: 'center', justifyContent: 'center' },
  clockHandMinute: { position: 'absolute', width: 1.6, height: 9, borderRadius: 1, backgroundColor: color.primary, top: 3 },
  clockHandHour: { position: 'absolute', width: 1.6, height: 6, borderRadius: 1, backgroundColor: color.primary, top: 7, transform: [{ rotate: '35deg' }] },
  arrivalPill: { marginTop: space.sm, backgroundColor: color.primary, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.xs },
  arrivalPillLabel: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.onPrimary },
  arrivalTitle: { textAlign: 'center', fontFamily: font.display, fontSize: fontSize.display, lineHeight: lineHeight.display, letterSpacing: letterSpacing.tight, color: color.ink, maxWidth: 440 },
  arrivalBody: { textAlign: 'center', fontFamily: font.body, fontSize: fontSize.base, lineHeight: lineHeight.base, color: color.inkMuted, maxWidth: 500 },

  arrivalIdentityRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm },
  arrivalAvatar: { width: 44, height: 44, borderRadius: radius.lg, backgroundColor: color.ink, alignItems: 'center', justifyContent: 'center' },
  arrivalAvatarLabel: { fontFamily: font.display, fontSize: fontSize.base, color: color.canvas },
  arrivalBusinessName: { fontFamily: font.display, fontSize: fontSize.md, lineHeight: lineHeight.md, letterSpacing: letterSpacing.tight, color: color.ink },
  arrivalBusinessMeta: { marginTop: 2, fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted },

  arrivalFactsGrid: { gap: space.sm, marginTop: space.md, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: color.borderFaint },
  arrivalFactRow: { gap: 2 },
  arrivalFactValue: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.ink },

  arrivalDisclaimerRow: { marginTop: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: color.borderFaint },
  arrivalDisclaimer: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },

  /* timeline */
  timelineRow: { flexDirection: 'row', gap: space.lg },
  timelineRail: { width: 12, alignItems: 'center' },
  timelineDot: { width: 11, height: 11, borderRadius: radius.pill, borderWidth: 2, borderColor: color.border, backgroundColor: color.canvas, marginTop: space.xs },
  timelineDotDone: { backgroundColor: color.primary, borderColor: color.primary },
  timelineLine: { flex: 1, width: 1.5, backgroundColor: color.border, marginTop: space.xs },
  timelineContent: { flex: 1, minWidth: 0 },
  timelineHeaderRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, flexWrap: 'wrap' },
  timelineTitle: { fontFamily: font.bodyMedium, fontSize: fontSize.base, color: color.inkMuted },
  timelineTitleDone: { fontFamily: font.bodySemi, color: color.ink },
  timelineWhen: { fontFamily: font.mono, fontSize: fontSize.sm, color: color.inkFaint },
  timelineBody: { marginTop: space.xs, fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
});
