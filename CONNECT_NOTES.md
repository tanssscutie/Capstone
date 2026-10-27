# Paano patakbuhin (web)

## 1. Backend
```
cd backend
python -m venv venv        # kung wala pang venv
venv\Scripts\activate      # Windows
pip install -r requirements.txt
uvicorn app.main:app --reload
```
Tatakbo sa http://localhost:8000. Config nasa `backend/.env` (tingnan `backend/.env.example`).

## 2. Frontend
```
cd frontend
npm install
npx expo start --web
```

---

# Mga gumaganang features (real API, walang mock)

**Account**
- Register (may email + confirm password, email OTP verification), Login gamit mobile O email.
- Continue with Google — kung may existing account sa parehong email, ini-link lang (walang duplicate).
- Forgot password at change password — parehong may email OTP. Walang `SMTP_HOST` = lalabas ang code sa backend console.
- Account Settings: palit mobile number, password, notification toggles.

**Onboarding / Verification**
- IDENTITY → OPERATIONS → DOCUMENTS, real file upload (encrypted sa disk gamit Fernet).
- Edit mode (`/onboarding?mode=edit`) — hindi naaapektuhan ang verification status.
- Kung tapos na ang IDENTITY+OPERATIONS, diretso na sa DOCUMENTS.
- Lahat ng submission dumadaan sa admin — walang auto-verify.
- Hindi verified = bawal mag-post/mag-quote, dinidirekta sa `/verification-status`.
- Tier 3 upgrade nangyayari pag na-accept ang award.

**Requirements**
- Post a Requirement: inline validation tugma sa backend, required documents (auto-suggest per category), required site address, category-based placeholders.
- Requirement Detail, My Requirements, Saved, Search, Business Profile, Ledger/audit trail (`/ledger`).
- Shortlist, Close without award, Cancel, Extend closing, Site notes.
- Notice of Award: buyer nag-propose → supplier Accept/Decline (auto-decline after 3 araw).
- Decision reminder kapag 3+ araw nang released pero walang desisyon.

**Quotations**
- Sealed submit (ref, hash, ledger), attachments, line items o total price lang.
- Isang active quotation lang per requirement; bawal mag-quote sa sariling requirement.

**Communication**
- Alerts (12 event types: ang 11 sa thesis, dagdag ang `REQUIREMENT_MATCH`), Clarification Q&A (public ang sagot), 1-to-1 messaging (bukas lang pag na-accept na ang award).

**AI / Matching**
- Gemini: document number extraction, category suggestion — advisory lang, 20s timeout, tahimik na nag-fa-fail kapag walang key/quota (free tier: 20 requests/araw).
- Semantic matching: `fastembed` + Qdrant (local mode, `backend/qdrant_data/`), walang external API.

**Admin**
- Businesses, Requirements, review queue, approve/reject, view uploaded documents.

**Iba pa**
- Lahat ng oras ay PHT (`app/core/clock.py`).
- Responsive: hamburger menu sa maliit na screen, collapsing header.

---

# Latest update (branch `trustlink-updates`, hindi pa naka-commit — base: `e3b21e5`)

**Delivery address: Barangay + ZIP (Post a Requirement, Delivery step)**
- Mga field: City (NCR) → **Barangay** (hinahanap na dropdown, 1,715 barangay mula sa opisyal na PSA PSGC Q1 2026) → **ZIP code** → **Street / Building / Unit Number**.
- ZIP: kusang napupunan **kapag sigurado lang** ang data (158 barangay, eksaktong tugma ang pangalan). Sa iba, pipili ang user mula sa listahan ng ZIP ng city (hal. "1605 · Ortigas Center") o ita-type niya. Puwedeng palitan sa lahat ng kaso. 4 na digit lang, bawal ang letra.
- Ang ZIP data ay galing sa open, Grit-derived list (`simonpangan/Philippines-Zip-Codes`), **hindi pa sa PHLPost**. Kapag bumalik ang eFOI portal, kunin ang Excel ng PHLPost (FOI request, Nob 2022) at patakbuhin ulit ang `backend/scripts/build_ncr_addresses.py`. Walang kailangang baguhin sa form.
- Backend: bagong `GET /meta/ncr-addresses` (public), `app/core/addresses.py`, at `app/data/ncr_addresses.json`. Bagong columns `requirement.barangay` at `requirement.zip_code` (auto-migrate). Bubuuin ng server ang `site_address`: "Unit 4B, Exchange Rd., Brgy. San Antonio 1605". Tinatanggihan ang barangay na hindi kabilang sa city.
- Mananatili ang dating isang-linyang address ng mga lumang requirement. Tests: `backend/tests/test_delivery_address.py`.

**Registration (`frontend/app/login.tsx`, `backend/app/schemas/auth.py`)**
- Bagong required field sa sign-up: `industry_category` (buyer = "Primary procurement category", seller = "Business category"). Kailangang nasa `app/core/categories.py` `CATEGORIES`; ito na rin ang pre-fill ng `User.industry_category` sa onboarding.
- Seller-only, required: `years_in_business` — codes `LESS_THAN_1 | 1_TO_3 | 4_TO_6 | 7_PLUS` (labels nasa `frontend/lib/api/auth.ts` `YEARS_IN_BUSINESS_OPTIONS`). Sa buyer, binubura ng backend kahit may ipadala.
- Bagong column `User.years_in_business` — auto-migrate sa startup (`database._migrate_user_years_in_business`), walang backfill.
- Login/register redesign: brand panel sa desktop, sliding Log in/Create account tabs, password checklist, compact `RolePicker` (`compact` prop, nag-wa-wrap sa maliit na screen), reduced-motion aware na animations.

**Public Business Profile (trust profile)**
- `GET /business/{id}/profile` kailangan na ng active na viewer; 404 kung admin/inactive ang target.
- Bagong fields sa `PublicBusinessProfileOut`: `member_since`, `verification_status`, `registration_document_types` (pumasang Tier-1 docs lang, walang laman/number), `quotations_submitted_count`, `quotations_awarded_count`, `requirements_cancelled_count`, `quotations_withdrawn_count`, `includes_sealed_activity`, `contact_details_visible`, `contact_person`, `contact_mobile`.
- Contact person/mobile — makikita lang ng verified na viewer, ng owner, at ng admin (Panel Suggestion #7.6).
- Counts galing sa `business_repository.profile_activity_counts`: award = confirmed `awarded` requirement + released na selected quotation. Sa ibang viewer, hindi kasama ang sealed activity at mga bago-mag-deadline na quotes; owner/admin kita lahat.
- `BusinessProfile.tsx`: "Business activity overview" (as buyer / as supplier) + bagong "Business transparency" card. Tinanggal ang tier badge.
- Tests: `backend/tests/test_business_trust_profile.py`.

**Post a Requirement (`PostRequirement.tsx`, `schemas/requirement.py`)**
- Indicative budget **required** na: `price_min` at `price_max` parehong > 0, at `max >= min`.
- Delivery window: bawal ang lumipas na petsa (PHT calendar day), at `delivery_end >= delivery_start` — validated sa frontend at backend.
- Half-filled na specification row (label lang o value lang) — hinaharang na, hindi na tahimik na tinatanggal.
- Delivery city: Metro Manila (NCR) pick list lang (`NCR_CITIES` sa `lib/data/philippines.ts`).
- UI redesign: numbered section cards, category cards na may blurb, focus/hover states, inline errors.

**Onboarding**
- City: NCR pick list na lang; province laging `Metro Manila` (`NCR_PROVINCE`). Lumang non-NCR city = unselected, kailangang pumili ulit.
- Placeholders/examples naka-base na sa category (Printing / Packaging & Labeling).

**Quotation submit (`submit-quotation.tsx`, `QuotationSubmission.tsx`)**
- Double-submit guard (ref + `submitting` state) para hindi tamaan ang 409.
- Pag nag-fail ang submit: inline error, naiiwan ang form at laman nito.
- Pag sealed na pero may attachment na nag-fail mag-upload: lalabas sa receipt ang notice (withdraw & resubmit), hindi na error screen.
- Caps tugma sa backend: notes 500 chars, line item description 200 chars.

**Admin**
- Bagong `frontend/components/ui/AdminKit.tsx`: shared access gate (`useAdminAccess`), page shell, status pills, search, filter chips, info grid, document rows, approve/reject panel — gamit ng `admin.tsx`, `admin-businesses.tsx`, `admin-requirements.tsx`.
- Dashboard: attention banner, KPI cards, 7-day registrations chart, review queue.
- `AdminSidebar.tsx`: `ADMIN_NAV_ITEMS` + `AdminMobileNav` (top bar + tabs sa phone).
- `admin-login.tsx` redesign; non-admin na tamang password ay bina-bounce at nili-clear ang token.

**Document request sa shortlisted (Panel Suggestion #3)**
- Pagkatapos ng release, puwedeng humingi ang buyer ng dagdag na document (sample photo, certificate, atbp.) sa **shortlisted** na quotation, habang wala pang desisyon (`status = closed`). Max 5 na pending kada quotation; puwedeng i-cancel habang pending.
- Ang supplier ang mag-a-upload (PDF/Word/image, max 10 MB). Puwede pang palitan hanggang `award_pending`. Encrypted sa disk (Fernet), `uploads/document_requests/`.
- Hindi ginagalaw ang quotation, kaya naka-lock pa rin ang presyo at hash. Naka-ledger ang `DOCUMENT_REQUESTED` at `DOCUMENT_SUBMITTED` (may SHA-256 ng file).
- Alert type `DECISION` ang gamit, para manatiling 11 ang alert types. Ang sinasabi lang ng alert ay "requested a document", hindi "shortlisted".
- Bagong table `quotationdocumentrequest` (auto-create). Code: `models/quotation_document_request.py`, `services/document_request_service.py`, routes sa `requirements.py`. Frontend: `OwnerDocumentRequests` / `RespondentDocumentRequests` sa `RequirementDetail.tsx`, wiring sa `app/requirement.tsx`.
- Tests: `backend/tests/test_document_requests.py`.

**Messaging pagkatapos ng award lang (Panel Suggestion #3)**
- Wala nang thread na ginagawa pagka-release. Ginagawa na lang ito pag in-accept ng supplier ang Notice of Award (`accept_award` → `_open_award_thread`).
- Unang laman ng thread: system message na may requirement ref, quotation ref, presyong na-award, contact person at mobile ng buyer at supplier, at paalala na hindi sakop ng TrustLink ang bayad, delivery at kontrata. Sa chat, "TrustLink" ang label nito.
- Bagong column `Message.is_system` (auto-migrate, `_migrate_message_is_system`).
- Ang mga lumang thread na nagawa pagka-release para sa hindi nanalo ay nakatago na at hindi na mapapadalhan (404). Ang lumang thread ng nanalo ay ginagamit ulit, hindi dinodoble.
- Sa Requirement Detail, sa awarded na quotation na lang lumalabas ang "Message" button.
- Tests: `backend/tests/test_award_messaging.py`.
- `message.body` ay `TEXT` na (dati `VARCHAR(255)`, kaya nag-fail ang mahahabang mensahe). Tuwing startup, kusang nilalagyan ng chat at system message ang mga awarded na wala pa nito (`backfill_award_threads`).

**Alert sa seller kapag may bagong requirement na tugma sa kanila**
- Pagka-publish ng requirement, makakatanggap ng alert na `REQUIREMENT_MATCH` ("New Tarpaulin requirement that matches your business") ang bawat seller na verified at active, nasa parehong category, at nag-aalok ng item na iyon. Kapag walang piniling item ang seller, sapat na ang category, ayon sa Panel Suggestion #2 (cold start).
- Sinusunod nito ang notification setting ng user (activity toggle). Nabubuksan ng alerts popover ang requirement (`related_requirement_id`). Kapag pumalya ang pag-alert, tuloy pa rin ang pag-post.
- Code: `requirement_service.matching_sellers` at `_alert_matching_sellers`. Tests: `backend/tests/test_match_alerts.py`.
- **Paalala sa thesis:** bagong alert type ito, kaya 12 na ang alert types.

**Mas mabilis na document extraction (AI image-to-text)**
- Hindi na nito pinapahinto ang buong backend: dati, habang nagbabasa ang AI, naghihintay ang lahat ng ibang request. Ngayon ay tumatakbo na ito sa thread pool (`run_in_threadpool` sa `business_service.extract_document_fields`).
- Naka-`thinking_level="minimal"` na ang Gemini, at pinapaliit muna sa 1600px ang malalaking larawan bago ipadala. Sa sukat ko: 11.6s dati, 5.5–8.6s ngayon, at tama pa rin ang nabasa.
- Hindi na nilo-log ang mismong nabasang ID number. Idinagdag ang `Pillow` sa `requirements.txt`. Tests: `backend/tests/test_document_extraction.py`.

**UI: alerts popover at nakagitnang layout**
- Ang bell sa header ay nagbubukas na ng maliit na dropdown (`components/ui/AlertsPopover.tsx`): 8 pinakabagong alert, "Mark all as read", at "See all alerts" papunta sa `/alerts`. Kapag pinindot ang alert, nabubuksan ang requirement nito (bagong `related_requirement_id` sa `NotificationOut`). Sabay na nag-a-update ang badge.
- Iisang nakagitnang lapad na (1180px, `layout.maxWidthShell`) ang header at lahat ng wide page, gaya ng LinkedIn. Pinaliit din ang `maxWidthWide` at `maxWidthDashboard` (dati 1100 at 1760).

**Attachment sa chat (isang file kada mensahe)**
- May 📎 button sa tabi ng "Write a message". Puwedeng file lang o file na may kasamang text.
- Mga pinapayagan: PDF, Word, Excel, JPG, PNG, AI, PSD, hanggang 10 MB. Bawal ang .exe at .zip, at iba pang file type na wala sa listahan.
- Encrypted sa disk (`uploads/messages/<thread_id>/`), may SHA-256. Ang dalawang panig ng chat at ang admin lang ang makakabukas (`GET /messages/threads/{id}/messages/{mid}/file`).
- Hindi naka-ledger, dahil usapan ito at hindi procurement record.
- Bagong columns `message.attachment_*` (auto-migrate). Tests: `backend/tests/test_message_attachments.py`.

**Transaction close-out (pag-alam kung tapos na ang transaction)**
- Nasa loob ng **chat** (Messages) ang mga button, sa itaas ng conversation. Wala ito sa Requirement Detail.
- Sa awarded na requirement, puwedeng mag-mark ang buyer o ang supplier ng **"Completed"** o **"Did not push through"** (kailangan ng dahilan). Kailangan itong i-confirm ng kabilang panig. Hindi ito kusang nagko-confirm.
- Kapag "Not yet" ang sagot ng kabila, kailangan ng dahilan, at puwedeng mag-mark ulit mamaya. Puwede ring i-withdraw ng nag-propose habang wala pang sagot.
- Bawat hakbang ay naka-ledger (`CLOSEOUT_PROPOSED / CONFIRMED / REJECTED / WITHDRAWN`), may TrustLink message sa chat, at may alert (`DECISION`).
- Sa trust profile, may bagong "Completed transactions" at "Transactions that did not push through". Bilang lang ito ng mga na-confirm ng dalawang panig.
- Hindi ito post-award tracking: walang delivery, bayad, o resibo. Ang pinagkasunduan lang ng dalawang panig ang naitatala.
- Bagong table `transactioncloseout` (auto-create). Code: `models/transaction_closeout.py`, `services/closeout_service.py`, routes `/requirements/{id}/closeout*`. Frontend: `ChatCloseoutBar` sa `HomeFeed.tsx`, wiring sa `app/home.tsx`.
- Tests: `backend/tests/test_closeout.py`.

**Iba pa**
- Na-delete ang `backend/uploads/.gitkeep`.

---



# Saan makikita ang code

- Frontend API: `frontend/lib/api/` (`client.ts`, `auth.ts`, `business.ts`, `requirements.ts`, `notifications.ts`, `messages.ts`, `admin.ts`, `mappers.ts`, `requirementsCache.ts`)
- Backend routes: `backend/app/api/routes/` — naka-register sa `backend/app/api/api.py`
