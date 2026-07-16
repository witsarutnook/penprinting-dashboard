# Post-deploy smoke อัตโนมัติ — Design

> **Date**: 2026-07-16
> **Status**: Approved by คุณนุ๊ก (brainstorm session 2026-07-16)
> **Scope**: 2 repos — `penprinting-calc` (ราคา) + `penprinting-dashboard` (health) — spec เก็บที่ dashboard repo ตาม convention
> **Related**: [[feedback_llm_reuses_stale_tool_numbers_from_history]] (เคส 4,776.25) · เคสนามบัตร smoke ค้าง 3 วัน · [[feedback_ai_quote_phase1a]] (env "ตั้งแล้ว" แต่ไม่ live)

## ปัญหา

ทุก deploy จบที่ "Vercel Ready" โดยไม่มีอะไรพิสูจน์ว่าของบน prod ทำงานจริง — ภาระ smoke ตกที่คุณนุ๊กไล่ทดสอบมือ ทำให้ smoke ค้างเป็นคิวข้ามวัน (นามบัตร 3 วัน) และ bug ราคาหลุดถึงลูกค้าจริงก่อนถูกจับ (เคส 4,776.25 จับได้เพราะคุณนุ๊ก smoke สดพอดี). ต้องการชุดตรวจอัตโนมัติที่รันหลังทุก deploy แล้วแจ้งกลุ่ม LINE ทีมงานเมื่อพัง — ให้เหลือเฉพาะ smoke ที่ต้องเป็นมนุษย์จริงๆ (แชต LINE/Messenger, UI)

## Decisions (จาก brainstorm)

| # | คำถาม | คำตอบ |
|---|---|---|
| D1 | Scope v1 | **Health checks + price baselines** — ไม่มี AI canary (LLM loop) ใน v1 |
| D2 | แจ้งเตือน | **Fail เท่านั้น** → push LINE กลุ่มทีมงาน (กลุ่มเดียวกับ morning report/escalation). ผ่าน = เงียบ ดูย้อนหลังใน GitHub Actions |
| D3 | จังหวะรัน | **เฉพาะหลัง production deploy** — ไม่มี cron canary รายวัน (YAGNI; เพิ่มทีหลังได้ด้วย `schedule:` บรรทัดเดียว) |
| D4 | Trigger + architecture | **Approach A**: `on: deployment_status` (event ที่ Vercel GitHub integration ส่งอยู่แล้ว) · แยก workflow ตาม repo เจ้าของ — **ไม่มี cross-repo trigger** |

## §1 ภาพรวม + Trigger

- Workflow ใหม่ repo ละ 1 ไฟล์: `.github/workflows/smoke.yml`
- Trigger: `on: deployment_status` — filter ให้รันเฉพาะ `state == 'success'` และ environment เป็น **Production** (ข้าม preview). ⚠️ ชื่อ environment จริงใน payload ของ Vercel อาจเป็น `Production` / `production` / รูปแบบอื่น — run แรกต้อง log `github.event.deployment.environment` ไว้ปรับ filter ให้ตรง (ความเสี่ยง = filter ไม่ match แล้ว**เงียบ** ไม่ใช่ fail — ต้อง verify ด้วย run จริงก่อนถือว่าเสร็จ)
- ตัว checks เป็น Node script เปล่า (`scripts/smoke.mjs`) ใช้ `fetch` built-in (Node 20+) **ไม่มี dependency ใหม่** — รันจากเครื่อง local ได้ตอน debug: `node scripts/smoke.mjs`
- Job เดียว, timeout สั้น (~5 นาที), `runs-on: ubuntu-latest`

## §2 Checks

### calc repo (เจ้าของราคา) — target `https://calc.penprinting.co`

1. **Price baselines**: `POST /api/quote` ด้วยสเปกตรึงไว้ → เทียบ response กับ `scripts/smoke-baselines.json` **ตรงเป๊ะทุก field ราคา** (unitPrice / total / mode ที่ระบบเลือก) — ผิดแม้ 0.01 = fail
   - ครอบ**ทุก productType ที่ API live**: brochure (offset + digital ให้ครบทั้ง 2 mode) · book · notebook · namecard
   - namecard ครบ 4 ช่องราคา (1/2 หน้า × เคลือบ/ไม่เคลือบ) + เคสปัดกล่อง (250 ใบ → 3 กล่อง = 900 ที่ 2 หน้า)
   - box / bag: เช็คตอน implement ว่า arm live จริงบน prod หรือยัง — live = ใส่ baseline ด้วย, ไม่ live = ระบุใน baselines ว่า intentionally absent
   - ตัวเลข baseline เก็บจากการยิง prod API จริงตอน implement (ไม่คำนวณมือ) แล้ว pin
2. **Auth fail-closed**: `x-quote-token` ผิด → ต้องได้ 401 (ไม่ใช่ 200)

### dashboard repo (เจ้าของ routes/webhooks) — target `https://dashboard.penprinting.co`

1. `/login` → 200
2. `/track` → 200
3. `/board` โดยไม่มี session cookie → redirect ไป `/login` (307/302/303 ยอมรับได้ — pin ค่าจริงตอน implement)
4. LINE webhook `/api/ai-quote/line`: GET → 200 (health) · POST signature ผิด → ต้อง reject (401/403 — pin ค่าจริง)
5. Messenger webhook `/api/ai-quote/messenger`: GET handshake token ผิด → 403
6. Admin API ตัวแทน (เช่น `/api/admin/slip-metrics`) โดยไม่มี session → ต้องถูกปฏิเสธ ไม่ใช่ 200

หลักคิดร่วม: เช็ค "ประตูทุกบานล็อคถูก + ทางเข้าหลักเปิด" — **read-only ทั้งหมด**: ไม่สร้าง/แก้ data, ไม่เรียก LLM, ไม่ยิง Apps Script

## §3 Baseline policy (กัน alert หลอกจากการเปลี่ยนราคาโดยตั้งใจ)

- `scripts/smoke-baselines.json` (calc repo) = fixture ตัวหนึ่ง: **commit ที่ตั้งใจเปลี่ยนราคา/สูตร ต้องอัปเดต baselines ในคอมมิตเดียวกัน**
- ข้อความ fail ต้องแนะทางแก้ตรงๆ: "ถ้าตั้งใจเปลี่ยนราคา → อัปเดต `scripts/smoke-baselines.json` แล้ว push"
- อัปเดต `/sync-paper-prices` slash command (workspace `.claude/commands/`) ให้มีขั้นตอน "อัปเดต smoke baselines" ใน checklist

## §4 แจ้งเตือน + กัน false positive

- **Fail → LINE push** เข้ากลุ่มทีมงานผ่าน `https://api.line.me/v2/bot/message/push` (env ชุดเดียวกับ morning report: `LINE_CHANNEL_TOKEN` + `LINE_GROUP_ID`) — ข้อความ: repo + check ที่พัง + expected vs actual + ลิงก์ GitHub run. **ผ่าน = เงียบ**
- **รวบทุก failure ก่อนแจ้ง** — รันทุก check จนจบ รายงานครั้งเดียว (ไม่หยุดที่ตัวแรก)
- **Retry ต่อ check สูงสุด 3 ครั้ง** เว้น ~10 วิ ก่อนนับ fail จริง — กัน cold start / network transient. Alert หลอก = กลุ่มเลิกเชื่อระบบ → ความเข้มนี้สำคัญกว่าความเร็ว
- LINE push ล้มเอง (token หมด ฯลฯ) → workflow ยัง exit 1 = แดงใน GitHub Actions เป็น backstop เสมอ

## §5 Secrets (user action ครั้งเดียว — คุณนุ๊ก)

| Repo | Secret | ค่ามาจาก |
|---|---|---|
| `penprinting-calc` | `QUOTE_API_TOKEN` | Vercel env ของ calc (ค่าเดิม) |
| `penprinting-calc` | `LINE_CHANNEL_TOKEN` · `LINE_GROUP_ID` | Vercel env ของ dashboard (ค่าเดิม) |
| `penprinting-dashboard` | `LINE_CHANNEL_TOKEN` · `LINE_GROUP_ID` | Vercel env ของ dashboard (ค่าเดิม) |

- Claude เตรียมคำสั่ง `gh secret set <NAME> --repo witsarutnook/<repo>` ให้คุณนุ๊กรันเองในเทอร์มินัล (ใส่ค่าผ่าน stdin prompt — **ค่า secret ไม่ผ่านแชต** ตาม pattern deploy-richmenu.sh)
- Smoke target เป็น prod URL ตรง (`calc.penprinting.co` / `dashboard.penprinting.co`) — ไม่ต้องใช้ Vercel token

## §6 Testing + rollout verify

- Logic ที่เป็น pure function (เทียบ baseline, สร้างข้อความ fail, ตัดสิน retry) → **TDD unit tests** ตาม convention repo (dashboard มี vitest อยู่แล้ว; calc เช็คตอน implement — ไม่มีก็เพิ่ม vitest dev-dep หรือย้าย logic ให้ test ได้ฝั่งใดฝั่งหนึ่ง ตัดสินใน plan)
- **Rollout verify ด้วยของจริง** (acceptance):
  1. Push commit → เห็น workflow fire หลัง Vercel Ready + run เขียว (พิสูจน์ trigger + filter environment ถูก)
  2. **Fail-path จริง 1 ครั้ง**: แก้ baseline ให้ผิดชั่วคราว 1 ค่า → push → ต้องเห็นข้อความ fail เข้ากลุ่ม LINE ครบ (repo/check/expected vs actual/link) → revert
  3. ยืนยัน preview deploy (ถ้ามี) **ไม่** trigger smoke
- **Acceptance criteria**: ทั้ง 2 repos มี smoke เขียวบน prod จริง + fail-path พิสูจน์แล้ว + `/sync-paper-prices` มีขั้นตอน baseline + NEXT-SESSION/AUDIT-BACKLOG อัปเดต

## Out of scope (v1)

- AI canary (คุยกับ quote engine จริง) — phase 2 ถ้าต้องการ
- Cron canary รายวัน — ตัดโดย D3 (เพิ่มทีหลัง = `schedule:` บรรทัดเดียว)
- Smoke ฝั่ง penprinting-web / photobook (ไม่มี logic ราคา — health เฉยๆ ค่อยว่ากัน)
- E2E UI (Playwright) — คนละชั้นกับ smoke นี้
