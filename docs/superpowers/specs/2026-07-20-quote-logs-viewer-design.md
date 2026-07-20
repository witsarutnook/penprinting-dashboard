# Quote Logs Viewer — เก็บ + ดู log การคุยลูกค้า↔AI ย้อนหลัง (`/quote-logs`)

- **วันที่:** 2026-07-20
- **สถานะ:** approved (คุณนุ๊ก approve design ใน session 2026-07-20 — scope M)
- **Repo:** `penprinting-dashboard`
- **เป้าหมาย:** ดูบทสนทนาลูกค้า↔น้อง PP ย้อนหลังทุกช่องทาง + tag จุดที่ AI ตอบผิดระดับข้อความ + โน้ต → เป็น worklist ตอนปรับ prompt

## บริบท — อะไรมีอยู่แล้ว (ห้ามทำซ้ำ)

- `ai_quote_sessions` เก็บบทสนทนาเต็มอยู่แล้ว: `conversation` JSONB = `ConversationTurn[] {role:'user'|'assistant', text}` — ทุก channel (dashboard/line/messenger), ถาวร ไม่ลบ
- `ai_quotes` เก็บทุกการเรียก compute_quote: `product_type + spec + result + unit_price + created_at` ผูก `session_id`
- escalation marker = `lead_status = 'escalated'` (และ `'กำลังติดตาม'` จาก order intent) — ไม่มี column แยก
- `/quote-leads` (admin+sales) = มุม lead — **ไม่แตะ logic** เพิ่มแค่ลิงก์ไขว้
- เขียน conversation: LINE/Messenger ผ่าน dep `saveConversation` ([webhook-router.ts:132](../../lib/ai-quote/webhook-router.ts)) wire ใน [customer-deps.ts](../../lib/ai-quote/customer-deps.ts) · dashboard = stateless client-replay ผ่าน [app/api/ai-quote/route.ts](../../app/api/ai-quote/route.ts)

## Decisions (pinned จากคุณนุ๊ก 2026-07-20)

| # | Decision | ค่า |
|---|---|---|
| D1 | สิทธิ์เข้าดู | **admin เท่านั้น** (`session.role !== 'admin'` → redirect `/board`) — เข้มกว่า /quote-leads |
| D2 | Tag ตอบผิด | **ระดับข้อความ** — กดบับเบิล AI + โน้ต; ลบ tag ได้ |
| D3 | ช่องทาง | **ทุกช่องทาง** (รวม dashboard ของทีมงาน) — filter ได้, ปุ่มลัด "เฉพาะลูกค้า" (line+messenger) |
| D4 | ตำแหน่ง | **หน้าใหม่ `/quote-logs`** + ลิงก์ไขว้จากแถว `/quote-leads` + nav sidebar (adminOnly) |

## 1. Data changes

### 1a. Per-turn timestamp (additive, backward-compatible)
- `ConversationTurn` เพิ่ม `ts?: string` (ISO) — optional เพราะ turn เก่าไม่มี
- ใส่ ts ณ **จุดสร้าง turn object** ที่ append ลง conversation:
  - **LINE + Messenger: ได้ ts ครบแน่นอน** — server เป็นเจ้าของ history (จุด push user turn + assistant turn ใน webhook-router ก่อน `saveConversation`)
  - **dashboard: ไม่ stamp ts** — client เป็นเจ้าของ history แบบ stateless replay (persist ตอน saveQuote จาก array ที่ client ส่ง); stamp ตอน save = ทุก turn ได้เวลาเดียวกัน หลอกตา → ปล่อยไม่มี ts, UI แสดงตามลำดับ (รองรับ turn ไม่มี ts อยู่แล้วโดย design)
- **ห้ามส่ง ts เข้า Anthropic API** — mapping `history → msgs` ใน [run.ts](../../lib/ai-quote/run.ts) เลือกเฉพาะ role+text อยู่แล้ว (ยืนยันแล้ว บรรทัด 78) — ไม่ต้องแก้
- Sanitizer ฝั่ง dashboard route (run.ts ~52-54 `turns.push({role, text})`) ตัด field แปลกทิ้ง — **ต้อง preserve `ts`** (string เท่านั้น, ไม่ valid = drop field ไม่ drop turn)

### 1b. ตารางใหม่ `ai_quote_turn_flags`
```sql
CREATE TABLE IF NOT EXISTS ai_quote_turn_flags (
  id            SERIAL PRIMARY KEY,
  session_id    INTEGER NOT NULL REFERENCES ai_quote_sessions(id) ON DELETE CASCADE,
  turn_index    INTEGER NOT NULL,          -- index ใน conversation array ณ เวลา tag
  turn_role     TEXT NOT NULL,             -- snapshot กัน index เพี้ยน
  turn_text     TEXT NOT NULL,             -- snapshot (cap 1000 chars)
  note          TEXT,                      -- "ผิดยังไง"
  flagged_by    TEXT NOT NULL,             -- session.user
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id, turn_index)
);
CREATE INDEX IF NOT EXISTS idx_turn_flags_session ON ai_quote_turn_flags(session_id);
```
- **Snapshot role+text ในแถว flag** = ดูย้อนหลังได้เสมอแม้ conversation array ถูกแก้/trim ในอนาคต (index เป็นแค่ตัวช่วยกระโดด)
- db-migrate route: idempotent `IF NOT EXISTS` ตาม convention — user กด `/api/admin/db-migrate` หลัง deploy

## 2. หน้า `/quote-logs` (admin only)

### List (server component + URL filter state — pattern เดียวกับ /board)
- Query params: `?channel=line|messenger|dashboard|customer` (customer = line+messenger) · `?q=` (ILIKE ชื่อ/contact ลูกค้า) · `?flagged=1` · `?status=escalated` · `?page=`
- เรียง `updated_at DESC` · LIMIT 50/หน้า + ปุ่มหน้าถัดไป (offset pagination พอ — โต๊ะนี้โตช้า)
- Loader ใหม่ `loadQuoteLogSessions(filters)` ใน lib ใหม่ [lib/ai-quote/logs.ts](../../lib/ai-quote/logs.ts): single query + LEFT JOIN aggregate `COUNT(ai_quotes)` + `COUNT(flags)` + `jsonb_array_length(conversation)` — **ไม่ N+1**
- คอลัมน์: id · channel (icon+label) · ลูกค้า (name/contact หรือ "–") · lead_status badge · เทิร์น · quotes · 🚩 · updated_at (Bangkok TZ)

### Transcript `/quote-logs/[id]`
- แชตบับเบิล: ลูกค้าซ้าย / AI ขวา + เวลาใต้บับเบิล (เฉพาะ turn ที่มี ts) — plain text (history เป็น plain อยู่แล้ว ไม่มี markdown)
- **แทรก quote cards ในไทม์ไลน์**: turn มี ts → วาง card (productType + spec ย่อ + unitPrice) ตาม `ai_quotes.created_at` ระหว่าง turns · session เก่าไม่มี ts เลย → แสดง quotes เป็น section "🧮 การคำนวณราคา" ท้าย transcript (เรียงเวลา)
- Header: channel · ลูกค้า · lead_status · เวลาเริ่ม/ล่าสุด · ลิงก์ไป /quote-leads (ถ้าเป็น lead)
- ไม่มีแก้/ลบบทสนทนา — read-only

### Tag ตอบผิด (client component เฉพาะจุด)
- กดบับเบิล **assistant** → popover: textarea โน้ต + ปุ่ม "🚩 Tag ว่าตอบผิด" / ถ้า tag แล้ว → แสดงโน้ต + ปุ่มลบ tag
- บับเบิลที่ tag แล้ว: ขอบแดง + 🚩
- Optimistic UI ไม่จำเป็น (การใช้งาน low-frequency) — submit → `router.refresh()`

### แท็บ "🚩 ที่ tag ไว้" (`/quote-logs?view=flags`)
- ลิสต์ flags ทุก session เรียงใหม่→เก่า: snapshot ข้อความ · โน้ต · ใคร tag · เมื่อไหร่ · ลิงก์ `/quote-logs/[id]#turn-N` (anchor scroll ไปบับเบิล)
- นี่คือ worklist ตอนปรับ prompt

### ลิงก์ไขว้ + nav
- แถวใน `/quote-leads` เพิ่มปุ่ม/ลิงก์ "ดูบทสนทนา" → `/quote-logs/[id]` (**แสดงเฉพาะ admin** — sales ไม่มีสิทธิ์เข้าหน้า logs ตาม D1; ซ่อนปุ่มไปเลยกัน 404 งง)
- [nav-config.ts](../../components/nav-config.ts): เพิ่ม `{ href: '/quote-logs', label: 'AI Logs', adminOnly: true }` ใน section **'AI Quote'** (line ~59 — ต่อจาก 'Lead ใบเสนอราคา')
- middleware matcher เพิ่ม `/quote-logs/:path*` (convention H2 — ทุกหน้าใหม่ต้องเข้า matcher)

## 3. API

- **`POST /api/ai-quote/flags`** `{sessionId, turnIndex, note?}` — admin gate (requireSession + role check) · validate session มีจริง + turnIndex อยู่ในช่วง conversation · snapshot role/text จาก DB ฝั่ง server (client ไม่ส่ง text เอง — กัน mismatch) · เขียน `audit_log` ตาม convention · 409 ถ้า tag ซ้ำ (UNIQUE)
- **`DELETE /api/ai-quote/flags`** `{sessionId, turnIndex}` — admin gate + audit_log
- อ่านทั้งหมดผ่าน server components — ไม่มี read endpoint ใหม่

## 4. Edge cases

- Session ที่ conversation ว่าง (`[]` — เข้าโหมดแล้วเงียบ) → โชว์ในลิสต์ (เทิร์น 0) + transcript ว่างพร้อมข้อความอธิบาย
- turnIndex ชี้ user turn → ปฏิเสธ 422 (tag ได้เฉพาะ assistant)
- Flag แล้ว conversation โตต่อ (ลูกค้าคุยเพิ่ม) → index เดิมยังชี้ถูก (array append-only) — snapshot สำรองอยู่แล้ว
- ชื่อลูกค้า NULL (dashboard sessions ส่วนมาก) → แสดง "ทีมงาน (dashboard)" หรือ "ไม่ระบุ"
- `?q=` sanitize ผ่าน parameterized ILIKE — ห้าม string concat
- ts ที่ client ส่งมา (dashboard replay) ไม่ใช่ ISO string → drop field เงียบๆ

## 5. Verification (convention repo นี้ — TDD + gates Node 22)

1. **TDD data layer**: tests ใหม่ `tests/ai-quote-logs.test.ts` — pin SQL shape ของ `loadQuoteLogSessions` (filters → WHERE ถูกตัว, aggregate ไม่ N+1) + flag insert/delete + snapshot มาจาก DB + turnIndex validation (assistant-only, in-range) + ts sanitizer preserve/drop
2. Gates: type-check / lint 0-err / vitest (471 + ใหม่) / build
3. **Preview smoke ด้วยข้อมูลจริง**: db-migrate → เปิด `/quote-logs` เห็น session จริง → เปิด transcript LINE จริง 1 อัน → tag 1 ข้อความ + โน้ต → เห็นใน view=flags → ลบ tag → sales login เข้า `/quote-logs` ต้องเด้ง `/board`
4. Post-deploy smoke อัตโนมัติเดิมครอบ health (ไม่เพิ่ม check — หน้า admin-gated 401/307 อยู่แล้วใน pattern)
5. **Pending user action หลัง deploy**: คุณนุ๊กกด `GET /api/admin/db-migrate` (สร้างตาราง flags) แล้วเปิด `/quote-logs` ดูของจริง

## 6. ไม่อยู่ใน scope (ตัดสินใจแล้ว)

- สถิติ/กราฟ (ระดับ L — ค่อยต่อยอดจาก data ที่มีครบแล้ว)
- Export CSV · แก้/ลบบทสนทนา · retention policy (เก็บถาวรต่อ)
- Backfill ts ของ turn เก่า (ทำไม่ได้ — ไม่มีข้อมูลเวลา)

## Rollback

- UI/route/loader = additive ทั้งหมด — revert commit เดียวจบ
- ตาราง flags + column ts ใน JSONB ไม่กระทบ path เดิมแม้ code revert (อ่านข้าม field ที่ไม่รู้จักอยู่แล้ว)
