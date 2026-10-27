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

# Round 2 bago ang defense (branch `trustlink-updates`, base: `b91dffb`)

**Alert sa lahat pagka-release ng quotations**
- Dati, ang buyer lang ang may alert. Ngayon, may `REQUIREMENT_RELEASED` alert din ("Quotations opened") ang **bawat respondent** pagka-release. Hindi nito sinasabi kung nanalo sila. May email din ito, at nabubuksan ang requirement mula sa alert.
- Code: `requirement_service._release_one`. Tests: `backend/tests/test_release_alerts.py`.

**Reports: "Businesses you've dealt with"**
- Sa itaas ng `/reports`, nakalista na ang mga business na naka-transact mo, kaya hindi na kailangang hanapin. Pinakabago ang nauuna, hanggang 8.
  - **bilang buyer:** mga supplier na na-release ang quotation sa requirement mo ("Quoted on REQ-… · title")
  - **bilang seller:** mga may-ari ng requirement kung saan na-release ang quotation mo ("You quoted on …")
- Hindi kasama ang sarili mo, ang admin, ang inactive na account, ang sealed pa na quotation, at ang mga kalabang supplier sa ibang posting.
- Code: `report_service.suggestions`, `GET /business/reports/suggestions`, at `features/reports/Reports.tsx`. Tests: `backend/tests/test_report_suggestions.py`.

**Buong Messages page (`/messages`)**
- May bagong "expand" na button (maliit na kahon) sa header ng chat dock, sa thread list at sa bawat conversation. Bubukas ito sa `/messages`. Kapag galing sa conversation, `?thread=<id>` at bukas na agad ang usapang iyon.
- **Desktop:** thread list sa kaliwa at conversation sa kanan. **Phone:** isang pane lang, may "←" pabalik sa listahan.
- Pareho ang features sa dock: attachments (📎), TrustLink messages, Report, at ang status bar ng transaction. May "View requirement" sa header ng conversation. Nagre-refresh ang bukas na usapan kada 15 segundo.
- Code:
  - `features/messages/Messages.tsx` at `app/messages.tsx`
  - `ConversationPane` (galing sa dati nang `ConversationWindow` sa `HomeFeed.tsx`): ginagamit ng dock at ng page
  - `lib/useMessaging.ts`: ang dating chat logic ng `app/home.tsx`, para iisa ang pinagkukunan ng dalawang screen

**Order status (parang LinkedIn), kapalit ng "Mark as completed" sa chat**
- **Seller (My Quotations):** "Mark in production" → "Mark out for delivery" → "Mark delivered". May opsyonal na note. Pasulong lang, puwedeng lumaktaw, at hindi na maibabalik.
- **Buyer (My Requirements at Requirement Detail):** "Confirm received" kapag Delivered na → **Completed**. Gumagawa ito ng confirmed na `TransactionCloseout(outcome="completed")`, kaya gumagana pa rin ang dating profile counts.
- **"Did not push through":** may dahilan, at kailangang i-confirm ng kabila ("Confirm" / "Not yet" / "Withdraw"). Gamit pa rin ang `closeout_service`. Habang naghihintay ito, hindi muna puwedeng mag-update ng status.
- **"Report a problem":** nasa panel ng My Quotations at Requirement Detail.
- **Chat:** wala nang button. Read-only na linya na lang: "Status: Out for delivery · Update in My Quotations". Bawat hakbang ay may TrustLink notice sa chat, alert (`DECISION`, may email), at ledger entry (`FULFILLMENT_UPDATED`, `ORDER_RECEIVED`, `ORDER_AUTO_CONFIRMED`, `ORDER_UNCONFIRMED`).
- **Kapag walang nag-a-update** (scheduler kada 5 minuto, `fulfillment_service.run_due`):
  - **3 at 7 araw** na walang update: may paalala sa may susunod na aksyon (seller, o buyer kapag Delivered na). Tig-iisa lang.
  - **Delivered at 14 araw na tahimik ang buyer:** auto-confirmed bilang Completed. Hanggang doon, puwede pang mag-"Did not push through" o mag-report ang buyer.
  - **14 araw na walang update at lampas 14 araw pagkatapos ng delivery window:** **Unconfirmed**. Hindi ito completed at hindi rin failed. Final na ito.
- **Profile:** may "Unconfirmed (no order updates)" at "Completion rate" na (completed ÷ awarded, bilang buyer o supplier).
- **Para sa demo:** walang shortcut sa 3/7/14 araw. Ipakita sa `test_fulfillment.py`, o baguhin muna ang `fulfillment_updated_at` sa DB.
- Code:
  - backend: `models/order_update.py`, `services/fulfillment_service.py`, `GET/POST /requirements/{id}/fulfillment`, `POST /requirements/{id}/fulfillment/confirm`, at bagong columns `requirement.fulfillment_status / fulfillment_updated_at / fulfillment_reminders` (auto-migrate)
  - frontend: `components/ui/OrderStatusPanel.tsx` (`OrderStatusPanel` at `OrderStatusLine`)
- Tests: `backend/tests/test_fulfillment.py`.

**Read-only na chat pagka-Completed o "Did not push through"**
- Kapag tapos na ang transaction, nakatago na ang "Open chat" (My Quotations) at ang "Message" (Requirement Detail). Sa My Quotations: "Transaction finished. The chat stays as a record in Messages."
- Nababasa pa rin ang thread sa Messages, pero kapalit ng composer ang "This transaction is completed. The conversation stays as a record."
- **Backend:** 409 sa pagpadala ng text o file, at may bagong `read_only` sa `GET /messages/threads`. Habang naghihintay pa ng confirm ang "Did not push through", bukas pa ang chat.
- Code: `message_service._is_read_only` at `_ensure_writable`, `isChatClosed` at `onStatus` sa `OrderStatusPanel.tsx`, at `ConversationPane` sa `HomeFeed.tsx`. Tests: `backend/tests/test_completed_chat.py`.

**Cooldown sa pagpalit ng password, email at mobile number (15 araw)**
- Isang beses lang kada 15 araw mapapalitan ang bawat isa. Habang naka-cooldown, nakatago ang "Change" at may "🔒 You can change this again on {date}". Sa backend, 429 kung susubukan pa rin.
- **Hindi hinaharangan ang Forgot password**, para hindi ma-lock out ang user, pero nagsisimula ito ng bagong cooldown.
- Para sa demo: `CREDENTIAL_CHANGE_COOLDOWN_DAYS=0` sa `backend/.env`.
- **Bagong "Change email"** sa Account Settings:
  - bagong email + current password → code na ipinapadala sa **bagong** email → Confirm
  - may notice sa **lumang** email na napalitan ito
  - bawal kung ginagamit na ang email ng iba, at bawal sa Google-linked na account (nakatali sa Google ang email)
- Code: `auth_service._check_cooldown`, `request_email_change_otp` at `confirm_email_change`, `models/email_change_otp.py`, `POST /auth/email/request-otp`, `PUT /auth/email`, bagong columns `user.password_changed_at / email_changed_at / mobile_changed_at` (auto-migrate), at `*_change_available_at` sa `/auth/me`. Tests: `backend/tests/test_credential_cooldown.py`.

**Profile na parang Facebook + LinkedIn (`BusinessProfile.tsx`)**
- **Layout:**
  - **Cover photo:** gradient kapag wala
  - **Profile picture:** nakapatong sa cover; initials kapag wala
  - pangalan, headline, at category · city · role
  - **Badges:** ✓ Verified, Tier, at Years in business (seller)
  - Website at Facebook links
- **Highlights row:** Completed · Completion rate · Awarded · Member since.
- **Section cards:** About, Past work, Capabilities at service areas, Activity, Business transparency.
- **Sariling profile:**
  - "Change cover" at "Change photo"
  - "Edit profile" (headline, About, website, Facebook)
  - **"Profile strength" meter:** picture, cover, headline, about, capabilities, past work (seller), at verified. May iisang button para sa susunod na kulang.
- **Mga larawan:**
  - **Avatar:** 512×512 square. **Cover:** 1600×400 (center-crop).
  - Laging JPEG, kaya natatanggal ang EXIF. Naka-encrypt sa disk (`uploads/profile/<id>/`). Naka-login na user lang ang makakakita.
  - JPG, PNG o WebP, hanggang 5 MB.
- **Links:** http/https lang. Kapag walang scheme, idinadagdag ang `https://`. Tinatanggihan ang `javascript:` at iba pang scheme.
- **Header:** ang larawan na rin ang nasa account chip, kung mayroon.
- **Past work: "Completed on TrustLink"** (seller):
  - Ang mga completed na order mo (Confirm received o auto-confirmed) ay lalabas bilang **"Suggested from your completed orders"** sa sarili mong profile, at ikaw lang ang nakakakita.
  - **"Show on profile"** para ipakita, at **"Hide"** para itago ulit.
  - Ang card: "✓ Verified transaction", title, item · quantity · city, at "For {buyer} · Completed {buwan}". **Walang presyo kailanman.**
  - May bagong linya tungkol dito sa Privacy Notice (section 5). Hindi binago ang bersyon, kaya hindi hihingan ulit ng consent ang lahat. Ipa-apruba sa adviser.
  - Code: `portfolio_service.completed_work` at `set_showcase`, bagong column `requirement.supplier_showcase` (auto-migrate), `GET /business/{id}/completed-work`, `GET /business/portfolio/suggestions`, at `POST /business/portfolio/showcase/{requirement_id}`. Tests: `backend/tests/test_completed_work.py`.
- **Business transparency bilang slides:** 3 slide (Verification → Track record → Contact) na may ‹ ›, mga tuldok, at "1 / 3". Malalaking numero sa Track record, at naka-highlight ang 0. Nasa "ⓘ More info" na ang mahabang paliwanag. Component: `TransparencySlides` sa `BusinessProfile.tsx`.
- **Activity:** nasa "ⓘ More info" na rin ang paliwanag ng Completed, Completion rate at Unconfirmed. Ang linya tungkol sa sealed activity lang ang laging nakikita.
- **Daan papunta rito:** sa account menu, ang **"My Profile"** ay bumubukas na sa bagong profile (`/business-profile?id=<sarili>`). Ang dating page (business name, contact, capabilities, "Update in onboarding") ay nasa **"Business details"** na (`/account`).
- **"Request a quote":** buyer na tumitingin sa seller.
  - Bubukas ang Post a Requirement na may banner na "Inviting {name} to quote — still open to every matching supplier and sealed until closing". Puwedeng "Remove".
  - Pagka-publish, may alert ang inimbitahan ("{buyer} invited you to quote"), kung verified, active, at nasa parehong category ito. Hanggang 5.
  - **Hindi ito private deal:** bukas pa rin sa lahat at sealed.
- Code:
  - backend: `services/profile_media_service.py`
  - mga endpoint: `PUT /business/profile/details`, `POST/DELETE /business/profile/{avatar|cover}`, `GET /business/{id}/avatar|cover`, at `RequirementCreate.invited_business_ids` (`requirement_service._alert_invited_sellers`)
  - bagong columns: `user.avatar_path / cover_path / headline / website_url / facebook_url` (auto-migrate)
  - frontend: `lib/useAuthedImage.ts`, ang `imageUri` sa `AvatarChip`, at ang invite banner sa `app/post-requirement.tsx`
- Tests: `backend/tests/test_profile_media.py`.

# Latest update (branch `trustlink-updates`, base: `e3b21e5`)

**Feedback batch bago ang final defense**
- **Security:**
  - May sariling random na `SECRET_KEY` na sa `backend/.env` (dati ang default sa code ang gamit). Kailangang mag-login ulit ng lahat.
  - Hinaharangan na ang banned, deactivated, at suspended na account **sa bawat request** at sa lahat ng paraan ng pag-login, kahit may dati nang token (`app/core/account_access.py`).
  - Tinanggal ang GitHub token sa URL ng `deploy` remote. **Kailangan pa rin itong i-revoke sa GitHub.**
- **Minimum na quotations:**
  - Kapag kulang sa `MIN_QUOTATIONS_TO_RELEASE` (default 4) pagsapit ng closing, i-e-extend ito nang `AUTO_EXTEND_DAYS` (3) isang beses, sealed pa rin, at may alert sa buyer, sa mga respondent, at sa mga tugmang seller.
  - Kapag kulang pa rin, magiging `insufficient_quotations` (Archived) ang status at mavo-void ang lahat ng quotation nang hindi nabubuksan.
  - Hindi rin makaka-award kapag kulang.
  - Makikita ang "2 of 4 quotations needed" sa Requirement Detail, at may paalala sa Closing step. Galing ang mga numero sa `GET /meta/rules`.
  - **Para sa demo:** ibaba ang `MIN_QUOTATIONS_TO_RELEASE` sa `.env` kung kulang ang seller accounts.
- **My Quotations:** may step tracker (Submitted → Released → Notice of Award → Awarded → Completed) at isang linya ng "next step" na may aksyon: Accept/Decline award, Open chat, o confirm completion.
- **Reports at moderation:**
  - Bagong `/reports` page (sa Account menu): maghanap ng business para i-report, at sundan ang status ng mga report mo.
  - May "Report" link din sa quotation card, sa "Posted by," at sa chat header.
  - Admin: Dismiss, Warn, Suspend 7 o 30 days, o Ban, na kailangan ng dahilan. Sa ban, kinakansela ang mga bukas na requirement at winiwithdraw ang mga sealed quotation ng user.
  - Lift restriction sa Businesses page. May audit trail (`ModerationAction`) at alert sa user at sa nag-report.
  - Bagong mga dahilan: Spam o pekeng requirement/quotation, at Bid manipulation o collusion.
- **Home:**
  - Nakatago na ang "Closing within 24 hours" kapag walang laman.
  - Button na ang "Update your capabilities."
  - Bagong "Getting started" guide (3 hakbang, kusang nache-check, may Hide).
- **Pagpapasimple:** ang mahahabang paliwanag sa Post a Requirement, sa Quote form, at sa Requirement Detail ay nasa likod na ng "ⓘ More info" (`components/ui/InfoHint.tsx`). Walang binurang impormasyon, at nakikita pa rin ang mga error.
- **Backup:** `backend/scripts/backup.py` (mysqldump + zip ng `uploads/` papunta sa `backend/backups/<petsa>/`, git-ignored).
- **Privacy Notice:** may konkretong retention periods na. **Mungkahi pa lang ang mga ito,** kaya ipa-apruba sa adviser. Wala pang pangalan ang DPO.
- Tests: `test_account_access`, `test_min_quotations`, `test_my_quotations_status`, at `test_moderation`.

**Deployment checklist (hindi kaya sa code)**
- **Hosting:** server para sa FastAPI at MySQL, at static hosting para sa `npx expo export --platform web`.
- **HTTPS certificate:** hal. Let's Encrypt, o sa hosting provider.
- **`backend/.env` sa server:**
  - bagong `SECRET_KEY` at `FILE_ENCRYPTION_KEY`, na itatabi nang ligtas at hiwalay sa backups
  - `DATABASE_URL`
  - `CORS_ORIGINS` = totoong domain ng frontend
  - `FRONTEND_URL` = totoong domain, para tama ang link sa email
  - SMTP (Gmail app password o transactional email provider)
  - `GOOGLE_*` kung gagamitin ang Google Sign-In, at i-update ang redirect URI
  - `MIN_QUOTATIONS_TO_RELEASE` pabalik sa 4
- **Frontend:** `EXPO_PUBLIC_API_URL` = totoong API URL bago mag-build.
- **Backup:** iskedyul ang `scripts/backup.py` (hal. araw-araw sa Task Scheduler o cron) at kopyahin palabas ng server.
- **Gemini:** bayad na tier o mas mataas na quota kapag maraming user (20 kada araw sa libre).
- **RA 10173:** pangalanan ang DPO, aprubahan ang retention, at isaalang-alang ang pag-register sa NPC kung kailangan.

**🔒 Security fix: sealed bidding (presyo ng kalaban)**
- Dati, kahit sinong naka-login ay nakakabasa ng `GET /requirements/{id}/quotations` pagkatapos ng release, kasama ang presyo, notes, at attachments ng lahat ng supplier.
- Ngayon, ang buyer na may-ari at ang admin lang ang makakabasa. 403 sa iba, pati sa mga kalabang supplier, sealed man o released. Nakikita pa rin ng supplier ang sarili niyang quotation sa "My Quotations."
- Tests: `backend/tests/test_quotation_visibility.py`.

**Portfolio (past work) sa profile ng seller**
- Bagong "Past work" sa Business Profile ng seller: gallery ng hanggang 8 larawan, may caption at puwedeng i-tag sa item (hal. Tarpaulin). Bubukas nang buo ang larawan kapag pinindot. Naka-login na user lang ang makakakita.
- Sa sariling profile: "+ Add photo" (JPG, PNG o WebP, hanggang 5 MB) at ✕ para tanggalin. Daan papunta rito: Account → "View public profile & past work".
- Seller na tapos na ang onboarding lang ang makakapag-upload (hindi kailangang verified). Pinapaliit ang larawan sa 1600px at ginagawang JPEG, kaya natatanggal ang EXIF (GPS at device info). Naka-encrypt ito sa disk.
- Backend: `models/portfolio_item.py`, `services/portfolio_service.py`, `GET /business/{id}/portfolio`, `GET /business/{id}/portfolio/{item}/image`, `POST /business/portfolio`, at `DELETE /business/portfolio/{item}`. Tests: `backend/tests/test_portfolio.py`.

**"Report this business"**
- May link na "Report this business" sa Business Profile ng iba (hindi sa sarili). Pipili ng dahilan (fake business, scam, hindi tinupad ang award, misleading na profile o documents, abusive, iba pa) at magbibigay ng detalye (10 characters pataas).
- Confidential: hindi kailanman sinasabihan ang ini-report na business, at walang alert na ipinapadala sa kanila.
- Mga proteksyon: verified account lang ang puwedeng mag-report, hindi puwede ang sarili o ang admin, isang bukas na report lang sa parehong business, at hanggang 5 report kada 24 oras.
- Admin: bagong page na **Reports** (`/admin-reports`, nasa sidebar). Resolve (may ginawang aksyon) o Dismiss (walang paglabag), at may notes. Ipinapakita kung ilan ang bukas na report laban sa parehong business. May banner sa dashboard kapag may naghihintay (`open_reports_count` sa admin stats).
- Backend: `models/business_report.py`, `services/report_service.py`, `POST /business/{id}/report`, `GET /business/admin/reports`, at `POST /business/admin/reports/{id}/review`. Tests: `backend/tests/test_business_reports.py`.

**Privacy Notice at consent (RA 10173, Data Privacy Act)**
- Bagong `/privacy` page (`features/legal/PrivacyNotice.tsx`). Nakasulat dito ang aktwal na ginagawa ng system: anong data ang kinokolekta, para saan, sino ang nakakakita ng ano (sealed quotations, contact details), mga third party (Google Gemini para sa document at category, email provider, Google Sign-In), proteksyon (bcrypt, encrypted files, hash-chained ledger), retention, mga karapatan ng data subject, at ang NPC.
- Required na checkbox sa registration. Tinatanggihan ng backend ang register kapag walang `accept_privacy: true`. Naka-record ang oras at bersyon (`User.privacy_consent_at` at `privacy_policy_version`, auto-migrate).
- Ang Google sign-up at ang mga dating account na wala pang consent ay ipinapadala sa `/complete-profile` para pumayag muna. Hindi kasama ang admin. Kapag binago ang notice, palitan ang bersyon sa `backend/app/core/privacy.py` **at** sa `PrivacyNotice.tsx`, at hihingan ulit ng consent ang lahat.
- May link din sa Help & Support. Tests: `backend/tests/test_privacy_consent.py`.
- **Kailangan pang pagpasyahan:** sino ang Data Protection Officer (support@trustlink.ph ang nakalagay ngayon), at ang eksaktong retention period.

**Email notifications para sa mahahalagang alert**
- Kusang may email copy ang mga alert sa `EMAIL_ALERT_TYPES` (`notification_repository.py`): DECISION (Notice of Award, accepted/declined, not selected, document request, close-out), REQUIREMENT_MATCH, REQUIREMENT_RELEASED, REQUIREMENT_CANCELLED, CLOSED_NO_AWARD, VERIFICATION, at DOCUMENT_FLAGGED. In-app lang ang chat messages, Q&A, closing reminders, at tier changes.
- Ipinapadala sa background (`email_service.send_alert_email`, 2-worker pool), kaya hindi bumabagal o pumapalya ang aksyon kahit mabagal o down ang SMTP. May link ang email papunta sa requirement.
- Bagong toggle na "Email" sa Account Settings → Notifications (`User.notify_email`, default on, auto-migrate). Kailangang naka-on din ang Activity.
- Walang `SMTP_HOST` = sa backend console lalabas ang email, gaya ng OTP. Tests: `backend/tests/test_email_alerts.py`.

**Nabubuksan na ang mga attachment ng requirement at ng quotation**
- `GET /requirements/{id}/attachments/{aid}/file`: attachment ng requirement mismo. Puwedeng buksan ng kahit sinong naka-login na nakakakita ng requirement.
- `GET /requirements/{id}/quotations/{qid}/attachments/{aid}/file`: kasabay ng quotation ang pagka-sealed nito. Kaya itong buksan ng supplier kahit kailan. Ang buyer at ang admin, pagka-release lang (409 habang sealed). Ang kalabang supplier, hindi kailanman (403).
- Naka-encrypt na sa disk ang mga bagong upload (Fernet). Nabubuksan pa rin ang mga lumang hindi naka-encrypt (`decrypt_bytes_lenient`).
- Frontend: mapipindot na ang file rows at chips sa Requirement Detail ("Open"). Bagong `openAuthedFile` sa `lib/api/client.ts`: binubuksan muna ang tab bago mag-fetch para hindi ito harangan ng popup blocker. Ginagamit na rin ito ng document requests at chat attachments.
- Tests: `backend/tests/test_attachment_downloads.py`.

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
