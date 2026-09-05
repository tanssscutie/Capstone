# Paano patakbuhin (both sa web)

## 1. Backend
```
cd backend
python -m venv venv        # kung wala pang venv
venv\Scripts\activate      # Windows
pip install -r requirements.txt
uvicorn app.main:app --reload
```
Tatakbo sa http://localhost:8000

## 2. Frontend
```
cd frontend
npm install
npx expo start --web
```


---

# Ano na ang gumagana (real API calls, hindi na mock)

- **Login / Register** (`app/login.tsx`) — real na `/auth/register` at `/auth/login`, token saved sa localStorage.
- **Pagkatapos mag-register** — dumidiretso na sa `/home` (hindi na sapilitang onboarding). Doon pa lang mag-de-decide ang user kung kailan siya mag-verify — opt-in, hindi forced.
- **Onboarding** (`app/onboarding.tsx`) — IDENTITY + OPERATIONS + DOCUMENTS lahat real POST na sa `/business/onboarding`, `/business/documents` (totoong file upload), `/business/submit-for-verification`. May city/province validation (kilalang PH cities/provinces lang, `lib/data/philippines.ts`) at "contact person must contain letters" check. May **edit mode** (`/onboarding?mode=edit`, galing sa My Profile) — pag nag-update ka lang ng profile, hindi na ito dumadaan sa DOCUMENTS step kaya hindi na-risk na mabawasan ang verification status/tier mo dahil lang sa pag-edit ng contact info.
- **Verification gating** — hindi verified na businesses ay bawal mag-post ng requirement (`post-requirement.tsx`) o mag-submit ng quotation (`submit-quotation.tsx`); dinidirekta sila sa `/verification-status` (kung may submitted na application) o `/onboarding` (kung wala pa).
- **Home feed** (`app/home.tsx`) — totoong open requirements (`/requirements`, order depende sa `signup_intent` mo — pag naghahanap ka ng supplier, closing-time order; pag naghahanap ka ng trabaho, boosted ng capability match), sariling requirements, at profile mo.
- **Post a Requirement** (`app/post-requirement.tsx`) — real POST, totoong file attachment picker, real date inputs sa delivery window, city validation.
- **Requirement Detail** (`app/requirement.tsx`) — OWNER_SEALED / OWNER_RELEASED (award) / RESPONDENT (submit/withdraw) — lahat real data.
- **Submit Quotation** (`app/submit-quotation.tsx`) — real POST, totoong sealed receipt (ref, hash, ledger number), at totoo na ang attachments (dati silent na natatapon lang, ngayon in-upload at naka-seal katulad ng requirement attachments).
- **My Quotations** (`app/quotations.tsx`) at **My Requirements** (`app/requirements.tsx`) — totoong listahan at status tracking.
- **Saved / Bookmarks** (`app/saved.tsx`) — real bookmark ng requirements.
- **Alerts / Notifications** (`app/alerts.tsx`) — real backend-persisted notifications (award decisions, questions asked/answered, messages received). Sinadya nang **walang** "quotation received" alert — hindi dapat alam ng buyer kung sino-sino na ang nag-submit bago pa mag-release, base sa thesis.
- **Clarification Q&A** — bago ma-close ang requirement, pwedeng magtanong ang mga respondent (`/requirements/{id}/questions`); ang sagot ng buyer ay **public**, makikita ng lahat ng respondents, base sa thesis.
- **1-to-1 Messaging** — bukas lang pagka-**release** (hindi pagka-award) ng isang quotation — kaya kausap ng buyer ang KAHIT SINONG na-release na respondent, hindi lang ang eventual winner, base sa thesis.
- **My Profile / Account** (`app/account.tsx`) — profile view + "Update in onboarding" (edit mode, safe sa verification bilang nabanggit sa itaas).
- **Account Settings** (`app/settings.tsx`) — real na ang pagpalit ng login mobile number (may current-password confirmation), pagpalit ng password (naka-verify laban sa lumang password), at notification preferences (Messages / Activity toggles) — pareho itong huli talagang nagsa-suppress ng bagong notification kung naka-off (`notif_repo.create_if_allowed`, gated sa backend, hindi lang sa UI).
- **Admin Dashboard** — listahan ng lahat ng Businesses (`/admin-businesses`) at Requirements (`/admin-requirements`), approve/reject wired, at pwede nang buksan/tignan ang mismong uploaded documents ng isang business (`/business/admin/documents/{id}/file`, authenticated).
- **Shortlist / "Close without award"** sa Requirement Detail (owner view) — real na endpoints ito ngayon (`/quotations/{id}/shortlist`, `/unshortlist`, `/close-without-award`), naka-lock pagkatapos ng final decision, at ma-notify lahat ng released respondents. Kasabay nito, na-ayos din ang isang totoong bug: hindi na-reflect ng owner's quotations view ang tunay na "awarded/not_selected" status pagkatapos mag-award — nakikita na ngayon ito nang tama kahit mag-reload.
- **`declared_id_number`** sa document upload — real na field na ito sa DOCUMENTS step (hiwalay per doc: DTI/SEC number, BIR TIN, Mayor's permit number), may client-side format validation na tumutugma sa backend check. Dati, ginagamit ang contact person name bilang placeholder — na dahilan kung bakit AUTOMATIC na na-fla-flag ang halos lahat ng submitted documents (hindi tumutugma sa expected format). Totoong bug na ito, hindi lang "gap."
- **Help & Support** (`/help`) — real na page na ito ngayon: FAQ tungkol sa sealed bidding, verification tiers, messaging, atbp., plus contact email.
- **Search** (sa header) — real na, sini-search ang "Business Opportunities" list (title, category, scope, delivery site, business name/location).
- **"View buyer profile" / "View profile"** sa Requirement Detail (Wide layout) — dati parehong dead button (`onPress={() => {}}`). Ngayon real na page (`/business-profile?id=`), bagong endpoint `GET /business/{id}/profile` — public-safe lang ang laman (walang contact person/mobile, walang login mobile number), na-verify sa live DB na talagang wala ang mga private fields sa response.
- **Totoong bug na na-ayos: bakit "nagbabago" yung pangalan ng business.** May DALAWANG magkaibang column ang isang User: `business_name` (kung ano ang inilagay sa Register) at `registered_name` (kung ano ang inilagay sa Onboarding, "exact name as on DTI/SEC certificate"). Ang `PosterOut` (yung nasa requirement card, "Posted by") ay `business_name` lang dati ang ipinapakita, habang ang bagong Business Profile page ay `registered_name`. Kaya kung magkaiba ang dalawang inilagay ng isang user, mukhang "nagbabago" ang pangalan pag-click ng "View buyer profile." Na-ayos: lahat ng lugar ngayon ay `registered_name ?? business_name` — parehong logic na ginagamit na dati para sa sariling pangalan ng viewer (`mapViewerBusiness`), consistent na ngayon kahit saan.

## QA pass (buong sweep, dead buttons + gap markers)

**Na-ayos habang nag-QA:**
- **`poster.city`/`poster.province` blangko dati kahit saan** — sanhi ito ng literal na blangkong "LOCATION" facts sa Requirement Detail (nag-render lang ng bare comma), AT sira ang "why this is matched to you" na text sa Home feed (`matchReason`, may blangkong space sa simula ng sentence) dahil `buyer.city` ay laging `''`. Parehong `PosterOut` fix gaya ng `registered_name` — dinagdag na `city`/`province` sa schema + lahat ng 3 construction sites, na-verify sa live DB.
- **Maling route sa `submit-quotation.tsx`** — `onOpenBuyer` ay pumupunta dati sa `/business/${id}` (walang ganitong route, magiging Unmatched Route) sa halip na `/business-profile?id=`. Na-fix.
- **Patay na mock code** — `features/post-requirement/mock.ts`'s `mockPoster` (hindi na ginagamit kahit saan, stale comment na "no backend yet") tinanggal; pinalitan ng pangalan yung file (`constants.ts`) dahil `CATEGORIES` na lang talaga laman niya, hindi na mock data.

**Anim na dead button — LAHAT ginawa na ring real:**
1. **Cancel / Extend requirement** (RequirementDetail, Wide OWNER_SEALED "Owner controls") — real na ngayon: "Extend closing time" (naka-lock kapag may existing quotation, `HasActiveQuotations`), "Cancel requirement" (pwede kahit may quotation na, pero binabalaan muna na ma-void ang mga ito — totoo palang backend behavior, hindi restricted gaya ng extend). Na-ayos din ang mismong maling copy ng card (sinasabi nitong locked ang "Cancellation" pero hindi pala talaga — tinanggal na sa listahan).
2. **"Edit contact and site notes"** (same card) — real na, may bagong `site_access_hours`/`site_access_notes` column sa `Requirement` + bagong endpoint (`PATCH /{id}/site-notes`), hindi kailanman naka-lock (informational lang, hindi bidding term). Ito rin ang naglagay ng laman sa dating laging-blangkong "SITE ACCESS" fact sa Requirement Detail.
3. **"Add your Mayor's permit"** (HomeFeed ProfileCard) — bagong page (`/add-permit`), tunay na file upload + permit number field (may client-side format validation). Isa lang itong document (hindi dumaan sa buong onboarding wizard), kaya walang panganib na ma-re-verify. Makikita lang ito kung Tier 1 ka pa (wala ka pang permit).
4. **"Use Previous Requirement"** (HomeFeed CtaBanner) — hinahanap ang pinaka-huling requirement mo (open man o closed), kino-clone ang category/title/scope/specifications/quantity/budget/city/address papunta sa Post a Requirement wizard bilang pre-filled na draft — pwede mo pa ring i-edit bago i-publish. Makikita lang ang button kung meron ka nang naipost dati.
5. **"Update your capabilities"** (HomeFeed HowMatchingWorksCard) — pumupunta na sa `/onboarding?mode=edit`.
6. **"Message"** (RequirementDetail, Wide OWNER_RELEASED quotation card) — hinahanap ang existing chat thread ng partikular na respondent (thread na meron na simula pagka-release), tapos dinadala ka sa Home na naka-bukas na agad yung conversation window.

Bonus fix habang ginagawa ang "Use Previous Requirement": nadiskubre na ang `/requirements/mine` (My Requirements) ay hindi rin nagbabalik ng `scope`/`specifications`/`quantity` — parehong `mapMyRequirement` blangko lagi ang mga ito dati ("BACKEND GAP"). Na-ayos na rin ito (bagong fields sa `MyRequirementOut`), na-verify laban sa totoong existing data sa DB, hindi lang test rows.

## Alam kong may gap pa (sinadya kong hindi tinapal ng peke)

1. **Ledger endpoint meron na** (`GET /{id}/ledger`) pero walang dedikadong "view full audit trail" na UI screen — ginagamit lang ito ngayon para hanapin yung sarili mong SUBMITTED entry sa Requirement Detail.
2. **Walang `GET /requirements/{id}`** sa backend — `lib/api/requirementsCache.ts` ang workaround (nag-iimbak ng mga requirement na nakuha na sa listahan).
3. **AI Integration** (thesis scope) — dalawang role ito sa papers: (a) document extraction model na nagba-basa ng ID/registration docs para i-prefill ang profile fields, (b) AI profile assistant (business description generator, category/keyword suggestions, plain-language na paliwanag ng trust tier). Parehong hindi pa gawa — kailangan muna ng AI API key (OpenAI/Claude/Gemini) bago simulan.
4. **Digital Business Passport** (Ed25519 signing + QR) — meron nang available na library sa backend (`cryptography`), pero hindi pa gawa.
5. **Semantic/vector-based matching, required-documents-per-requirement** — parehong wala pa.

Lahat ng networking code nasa `frontend/lib/api/`:
- `client.ts` — base fetch wrapper + token storage
- `auth.ts`, `business.ts`, `requirements.ts`, `notifications.ts`, `messages.ts`, `admin.ts` — isa-isang endpoint group
- `mappers.ts` — nag-cconvert ng backend response papuntang frontend types
- `requirementsCache.ts` — workaround para sa kulang na single-requirement endpoint

Backend routes nasa `backend/app/api/routes/`: `auth.py`, `business.py`, `requirements.py`, `notifications.py`, `messages.py` — lahat naka-register sa `backend/app/api/api.py`.


