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

1. Business account: business name, mobile number, password.
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
   document (format ng ID number, expiry date, pagtutugma ng business/owner
   name) — malinis na docs = auto-pass, may isyu = na-fla-flag.
3. Kung may flagged na document, kailangan ng **admin review**
   (approve/reject, may notes).
4. Kapag kumpleto na ang required docs (DTI/SEC + BIR, parehong "pass"):
   **Verified.**

### Trust Tiers

| Tier | Kailangan |
|---|---|
| **1** | DTI/SEC + BIR — parehong pumasa |
| **2** | Tier 1 + Mayor's permit pumasa |
| **3** | Tier 2 + naka-**10 beses nang na-award** bilang supplier |

Hindi kasama sa tier ang delivery quality — wala talagang sinusubaybayan ang
system pagkatapos ng award.

---

## Phase 2 — Pag-post ng Requirement (Buyer)

1. Verified na business lang ang makakapag-post.
2. Fields: category, scope, quantity, budget range (min/max), delivery site +
   window, closing date/time, attachments.
3. Status: **OPEN.**
4. Habang OPEN: pwedeng magtanong ang ibang businesses (clarification Q&A) —
   ang sagot ng buyer ay **public**, makikita ng LAHAT ng nakikinig, hindi
   lang ng nagtanong.
5. Habang OPEN, ang buyer mismo — kasama na siya — ay **hindi makikita** kung
   sino/ilan ang nag-submit ng quotation. Isang **running count** lang ang
   nakikita niya, walang pangalan, walang presyo.

---

## Phase 3 — Pag-submit ng Quotation (Supplier)

1. Kahit sinong ibang verified na business ay pwedeng mag-submit — **isa**
   lang na sealed quotation bawat requirement.
2. Fields: total price, lead time, payment terms, validity, notes,
   attachments.
3. Sa sandaling i-submit: naka-hash agad ang laman, naka-lock na ang presyo,
   at naitala sa **ledger** (tamper-evident hash chain) bilang `SUBMITTED`
   entry — kahit sino, kasama ang buyer, ay hindi na makikita ang laman hangga't
   hindi pa closing time.
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

Pagkatapos ma-release, pwedeng:

- **I-shortlist** muna (private working note lang, hindi nakikita ng respondent,
  pwedeng i-toggle nang paulit-ulit habang wala pang final decision).
- **I-award** ang isa — siya ang mananalo, lahat ng iba ay `NOT_SELECTED`,
  lahat ng released respondent ay na-notify. May `AWARDED` na ledger entry.
- **"Close without award"** — walang pinili sa lahat. Final decision pa rin
  ito (parehong bigat ng award), lahat ay na-notify, may `CLOSED_NO_AWARD`
  na ledger entry.

Pagkatapos ng alinman sa dalawa: **naka-lock na** — hindi na puwedeng
i-shortlist, i-award, o i-close ulit.

---

## Mga tumatakbo sa likod (cross-cutting)

- **Alerts** — verification update, tinanong/sinagot na Q&A, award decision,
  "closing soon" reminder, bagong mensahe. Bawat isa naka-gate sa
  **Messages / Activity** na toggle sa Account Settings — pwedeng i-off ang
  isang kategorya nang hindi nawawala ang isa. **Sadyang WALA** ("by design")
  alert para sa bawat indibidwal na quotation submission — hindi dapat alam
  ng buyer kung sino-sino na ang nag-submit bago pa mag-release.
- **Saved** — pwedeng mag-bookmark ng open requirement kahit kanino.
- **Search** — hinahanap sa title, category, scope, delivery site, at
  pangalan/lokasyon ng business — sa Business Opportunities list sa Home.
- **Admin** — hiwalay na login. Nakikita LAHAT ng businesses at requirements
  (hindi lang flagged), approve/reject ng documents, at pwedeng buksan ang
  aktwal na uploaded file ng isang business.

---

## Status glossary

**Requirement**: `OPEN` → `CLOSED` (released, pending decision) →
`AWARDED` **o** `CLOSED_NO_AWARD` &nbsp;|&nbsp; `CANCELLED` (kung pinigil ng
buyer BAGO pa mag-close — hiwalay sa "close without award", na PAGKATAPOS
mag-release)

**Quotation**: `SUBMITTED` (sealed) → `RELEASED` → `SHORTLISTED` (optional)
→ `AWARDED` **o** `NOT_SELECTED` &nbsp;|&nbsp; `WITHDRAWN`

---

*Huling update: kasabay ng pag-fix ng shortlist/close-without-award,
declared ID number, search, at Account Settings — tingnan din ang
`CONNECT_NOTES.md` para sa listahan ng mga gaps na natitira pa.*
