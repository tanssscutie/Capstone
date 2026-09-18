# TrustLink — Buong Proseso ng System

Reference doc para sa team: paano dumadaan ang isang requirement (opportunity) at
quotation (bid) mula simula hanggang matapos, at ano ang ginagawa ng system sa
bawat hakbang. Base ito sa aktwal na gawi ng backend/frontend ngayon, hindi
plano lang — kung babaguhin ang logic, dito rin dapat i-update.

---

## Ang buong loop, maikling bersyon

```
Register → (opt-in) Mag-verify → Mag-post ng requirement / Mag-quote
  → Mag-close (sealed → released) → Mag-desisyon (award o close without award)
  → Messaging bukas
```

---

## Phase 0 — Pag-register

1. Business account: business name, mobile number, password. **O** "Continue
   with Google" — bagong account kaagad kung first time (walang password,
   Google email/pangalan ang gagamitin), tapos hihingin ang mobile number nang
   isang beses lang bago makapasok sa Home (kailangan pa rin ito — ginagamit sa
   buong system, contact info, atbp.).
2. Diretso sa **Home** pagkatapos mag-register — **hindi na** sapilitang
   onboarding. Verification ay opt-in, pipindutin na lang sa Home kapag ready na.
3. Sa Home, makikita agad ang listahan ng OPEN na requirements (business
   opportunities) — pwede nang mag-browse kahit hindi pa verified.

---

## Phase 1 — Pag-verify (kailangan bago makapag-post o makapag-quote)

1. **Onboarding** — 3 hakbang:
   - **Identity**: bakit ka nandito (maghahanap ng supplier / maghahanap ng
     trabaho / pareho), registered name, business type, category, city/province,
     contact person + mobile.
   - **Operations**: capabilities, service areas.
   - **Documents**: DTI (sole proprietorship) o SEC (partnership/corporation)
     certificate + BIR certificate of registration — **required**. Mayor's
     permit — optional. Bawat document may kasamang **totoong ID/certificate
     number** (hindi na basta contact person name), na-che-check agad ang
     format (hal. DTI = 6-15 digits, BIR TIN = 000-000-000).
2. **Submit for verification.** Awtomatikong tine-tsek ng system ang bawat
   *document* (format ng ID number, expiry date, pagtutugma ng
   business/owner name) — malinis na docs = "pass" per-document, may isyu =
   na-fla-flag per-document. Isa lang itong per-document na signal para sa
   admin, hindi ito ang desisyon.
3. **Laging pumapasok sa admin review queue** ang bawat submission — kahit
   "pass" ang LAHAT ng document sa mga automatic check. Isang document na
   "pass" ay hindi kapareho ng isang taong talagang nag-review nito. Ang
   status pagkatapos ng submit: "Submitted" (walang flagged na document) o
   "Under review" (may flagged) — pareho, hinihintay pa rin ang desisyon ng
   admin.
4. Ang admin lang ang pwedeng mag-**Verify** (approve/reject, may notes) —
   hindi ito automatic kahit kailan, kahit kumpleto at "pass" na ang lahat
   ng required docs (DTI/SEC + BIR).

### Trust Tiers

| Tier | Kailangan |
|---|---|
| **1** | DTI/SEC + BIR — parehong pumasa |
| **2** | Tier 1 + Mayor's permit pumasa |
| **3** | Tier 2 + naka-**10 beses nang na-award** bilang supplier |

Ang "10 beses na-award" ay binibilang lang mula sa mga Notice of Award na
talagang **na-Accept** na (`status = "awarded"`) — hindi kasama ang mga
nakabinbin pang proposal (`award_pending`). Ang tier ay awtomatikong
kina-check ulit sa sandaling ma-Accept ang isang award (hindi na kailangang
maghintay ng bagong document upload para dumaan doon) — kaya kapag umabot ka
sa ika-10 award mo, agad kang tataas papuntang Tier 3, may notification.

Kung Tier 1 ka pa, may "Add your Mayor's permit" na shortcut sa Home
(`/add-permit`) — isang beses lang, isang document lang, hindi na kailangang
balikan ang buong onboarding wizard.

Hindi kasama sa tier ang delivery quality — wala talagang sinusubaybayan ang
system pagkatapos ng award.

Kapag sinubukan mong mag-post o mag-quote nang hindi pa verified (kahit hindi
mo pa sinisimulan ang onboarding), palaging dadalhin ka muna sa
**Verification Status** page — doon mo mismo pipindutin ang "Start
verification" kapag handa ka na, hindi ka basta itinatapon diretso sa
onboarding wizard.

---

## Phase 2 — Pag-post ng Requirement (Buyer)

1. Verified na business lang ang makakapag-post.
2. Fields: category, scope, quantity, budget range (min/max), delivery site +
   window, closing date/time, attachments, **required documents** (opsyonal —
   listahan ng qualifying documents na hihingin sa bawat respondent, hal. PCAB
   License, Sanitary Permit — "soft" na requirement lang, hindi hard block sa
   pag-submit ng quotation).
3. Status: **OPEN.**
4. Habang OPEN: pwedeng magtanong ang ibang businesses (clarification Q&A) —
   ang sagot ng buyer ay **public**, makikita ng LAHAT ng nakikinig, hindi
   lang ng nagtanong.
5. Habang OPEN, ang buyer mismo — kasama na siya — ay **hindi makikita** kung
   sino/ilan ang nag-submit ng quotation. Isang **running count** lang ang
   nakikita niya, walang pangalan, walang presyo.
6. **Owner controls habang OPEN pa** (Requirement Detail):
   - **Extend closing time** — puwede lang kung wala pang quotation na
     dumarating; naka-lock agad pagka-may unang quotation.
   - **Cancel requirement** — puwede anumang oras habang OPEN, kahit may
     quotation na — pero i-void nito ang mga sealed quotation na dumating na.
   - **Edit contact and site notes** (access hours, gate code, atbp.) —
     **hindi kailanman naka-lock**, dahil impormasyon lang ito, hindi
     bidding term.
7. **"Use Previous Requirement"** sa Home — kino-clone ang pinaka-huling
   requirement mo (category, scope, specs, quantity, budget, city/address)
   papunta sa Post a Requirement wizard bilang pre-filled na draft.

---

## Phase 3 — Pag-submit ng Quotation (Supplier)

1. Kahit sinong ibang verified na business ay pwedeng mag-submit — **isa**
   lang na sealed quotation bawat requirement.
2. Fields: total price (o **itemized line items** — description/qty/unit
   price per row, kung pinili ang "Line items" mode sa halip na "Total price
   only"), lead time, payment terms, validity, notes, attachments — kasama
   dito ang mga naka-label na attachment kung meron mang required documents
   ang requirement.
3. Sa sandaling i-submit: naka-hash agad ang laman (kasama na ang line items
   kung meron), naka-lock na ang presyo, at naitala sa **ledger**
   (tamper-evident hash chain) bilang `SUBMITTED` entry — kahit sino, kasama
   ang buyer, ay hindi na makikita ang laman hangga't hindi pa closing time.
4. Pwedeng i-withdraw bago mag-close.

---

## Phase 4 — Pagsara at Pag-release (system clock, hindi tao ang nagpapatakbo)

1. Sa eksaktong closing time ng requirement, awtomatikong **nire-release**
   ang LAHAT ng natitirang sealed quotation nang **sabay-sabay** — walang
   sinuman ang nakakuha ng advantage sa timing.
2. Bawat release ay may `RELEASED` na ledger entry.
3. Ngayon lang makikita ng buyer ang totoong laman ng lahat ng quotation.
   Ang bawat respondent naman ay makikita lang ang sarili niyang submission.
4. **Dito na bukas ang 1-to-1 messaging** — kahit sino sa mga **released**
   na respondent, kausap na ng buyer, hindi lang yung eventual winner.

---

## Phase 5 — Pagdesisyon (Buyer)

Walang hard deadline ang buyer para magdesisyon pagkatapos ma-release — pwede
niyang i-shortlist, mag-propose ng award, o mag-close-without-award anumang
oras, walang system clock na pumipilit. Kapag 3+ araw nang naka-release ang
isang requirement na wala pang desisyon (hindi pa na-shortlist/na-propose/
na-close), may lumalabas na **reminder banner** (Requirement Detail, at
maikling linya sa My Requirements) — computed live mula sa `released_at`,
hindi bagong Alert type (fixed sa 11 ang system events per thesis Coverage of
the Study), kaya walang panganib na masira ang bilang na iyon. Nudge lang ito,
hindi pumipilit — walang auto-close, at nawawala rin kaagad kapag may
desisyon na.

Pagkatapos ma-release, pwedeng:

- **I-shortlist** muna (private working note lang, hindi nakikita ng respondent,
  pwedeng i-toggle nang paulit-ulit habang wala pang final decision).
- **Mag-send ng "Notice of Award"** sa isang respondent — hindi ito diretsong
  final. Ang napiling respondent ay may ilang araw (3 days default) para
  **Accept** o **Decline**:
  - **Accept** — dito lang talaga nagiging `AWARDED` — lahat ng iba ay
    `NOT_SELECTED` **ngayon lang**, na-notify na lahat. May `AWARDED` na
    ledger entry. Bago tumanggap, ang ibang respondent ay hindi pa rin
    alam kung may proseso ng award na nangyayari — parehong "released"
    lang pa rin sila.
  - **Decline** (o hindi sumagot sa loob ng deadline — awtomatikong
    "declined" ito ng system clock) — bumabalik sa "closed" (parang hindi
    pa na-award), at pwede nang mag-propose ang buyer ng ibang respondent.
    May `AWARD_DECLINED` na ledger entry.
  - May `AWARD_NOTICE_SENT` na ledger entry sa mismong pag-propose.
- **"Close without award"** — walang pinili sa lahat. Final decision pa rin
  ito (parehong bigat ng award), lahat ay na-notify, may `CLOSED_NO_AWARD`
  na ledger entry. Hindi pwede habang may nakabinbing Notice of Award —
  kailangan munang malutas iyon (accept/decline/expire) bago makapag-close
  without award.

Pagkatapos ma-**Accept** o ma-"close without award": **naka-lock na** —
hindi na puwedeng i-shortlist, i-propose ng bagong award, o i-close ulit.
Habang naka-**"award pending"** (may nakabinbing Notice of Award), naka-lock
din pansamantala ang shortlist at close-without-award, pero hindi pa
`AWARDED` — babalik lang ito sa "closed" kung ma-decline o mag-expire.

---

## Mga tumatakbo sa likod (cross-cutting)

- **Alerts** — 11 system events, lahat traceable sa isang naka-recordang
  aksyon: requirement closing soon, requirement released, requirement
  cancelled, award decision, closed without award, verification update,
  tier upgrade, flagged document, bagong mensahe, tinanong na Q&A, sinagot na
  Q&A. Bawat isa naka-gate sa **Messages / Activity** na toggle sa Account
  Settings — pwedeng i-off ang isang kategorya nang hindi nawawala ang isa.
  **Sadyang WALA** ("by design") alert para sa bawat indibidwal na quotation
  submission — hindi dapat alam ng buyer kung sino-sino na ang nag-submit
  bago pa mag-release.
- **Ledger / audit trail** — dedikadong "View full audit trail" screen
  (`/ledger`) mula sa Requirement Detail — buong timeline ng lahat ng entries
  (Published/Submitted/Withdrawn/Closed/Cancelled/Notice of Award
  sent/Award declined/Awarded/Closed without award) na may sequence number,
  actor, at hash chain — hiwalay ito sa pag-verify ng integrity ng sariling
  quotation.
- **Saved** — pwedeng mag-bookmark ng open requirement kahit kanino.
- **Search** — hinahanap sa title, category, scope, delivery site, at
  pangalan/lokasyon ng business — sa Business Opportunities list sa Home.
- **Admin** — hiwalay na login. Nakikita LAHAT ng businesses at requirements
  (hindi lang flagged), approve/reject ng documents, at pwedeng buksan ang
  aktwal na uploaded file ng isang business — decrypted on the fly, dahil
  naka-encrypt (Fernet) ang mga ito habang naka-imbak sa disk.
- **Display name** — opsyonal na trading name (Onboarding, IDENTITY step).
  Kapag nilagyan, ito ang lumalabas sa halip na ang registered name kahit
  saan makikita ng ibang business ang pangalan mo — requirement cards,
  business profile, header. Blangko = registered name pa rin ang gamit.

---

## Status glossary

**Requirement**: `OPEN` → `CLOSED` (released, pending decision) →
`AWARD_PENDING` (Notice of Award sent, hindi pa final — bumabalik sa
`CLOSED` kung ma-decline o mag-expire) → `AWARDED` **o** `CLOSED_NO_AWARD`
&nbsp;|&nbsp; `CANCELLED` (kung pinigil ng buyer BAGO pa mag-close — hiwalay
sa "close without award", na PAGKATAPOS mag-release)

**Quotation**: `SUBMITTED` (sealed) → `RELEASED` → `SHORTLISTED` (optional)
→ `AWARD_PENDING` (ito lang ang proposed candidate; ang ibang released
quotations ay nananatiling `RELEASED`) → `AWARDED` **o** `NOT_SELECTED`
&nbsp;|&nbsp; `WITHDRAWN`

---

*Huling update: Notice of Award (propose → accept/decline/auto-expire, sa
halip na isang-hakbang na final award kaagad) — tingnan din ang
`CONNECT_NOTES.md` para sa listahan ng mga gaps na natitira pa.*
