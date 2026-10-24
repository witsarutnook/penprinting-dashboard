# น้อง PP customer-flow eval (`eval/pp-customer/`)

วัด **เทิร์นเดียว** ของน้อง PP (prompt ลูกค้า `lib/ai-quote/prompt-customer.ts`) บนบทสนทนาจริงจาก prod:
แต่ละเคส = ประวัติแชตจริงก่อนหน้า (history) + ข้อความลูกค้า 1 ข้อความ → รัน `runQuoteTurn` ของแอปจริง
(tool `compute_quote` → calc API, `send_price_table`) แล้วให้คะแนนเทิร์นนั้น

## รัน

```bash
# 1) calc API local (tool ของแอป) — preview_start "calc-dev" หรือ:
#    (cd ../print-calculator-next && QUOTE_API_TOKEN=test npx next dev -p 3100)
# 2) key ใน .env.eval.local (gitignored):  ANTHROPIC_API_KEY=sk-ant-...
# 3) baseline (Sonnet 5.5 = prod):
node --env-file=.env.eval.local --import tsx --conditions=react-server \
  eval/pp-customer/run-eval.mjs --flow .claude/hillclimb/pp-customer \
  --variant baseline --model claude-sonnet-5-5 --reps 2
# 4) variant (เช่น Opus 5.5):
node --env-file=.env.eval.local --import tsx --conditions=react-server \
  eval/pp-customer/run-eval.mjs --flow .claude/hillclimb/pp-customer \
  --variant v1 --model claude-opus-5-5 --reps 2
# 5) รายงาน:
node eval/pp-customer/build-report-lite.mjs .claude/hillclimb/pp-customer/
```

ครั้งแรก (หรือหลังแก้ไฟล์ใน `_state.json.harness_paths`) runner จะหยุดและขอให้ **คน** รันด้วย
`--approve-harness` หนึ่งครั้ง — เป็นตัวตรวจจับว่า harness/prompt เปลี่ยนตั้งแต่รอบที่ approve

## ไฟล์

| ไฟล์ | หน้าที่ |
|---|---|
| `run-eval.mjs` | harness จาก Claude API skill scaffold (resume · backoff · ceiling · served-model assert · errors sidecar) — ไม่แตะ |
| `impl.mjs` | ส่วนของแอป: `loadCases` / `runCase` (เรียก `runQuoteTurn` จริงผ่าน client ที่บันทึกทุก round) / `gradeHard` (กฎแข็งด้วยโค้ด) / กรรมการ Fable 5.1 (structured output) |
| `cases.json` | เคส (ประวัติจริงจาก prod, mask ข้อมูลติดต่อแล้ว) + label `expected` ที่คุณนุ๊ก sign-off |
| `selftest.mjs` | oracle / null / known-bad ของ grader — ฟรี รันก่อนทุกครั้งที่แก้ grader |
| `build-candidates.mjs` | export → candidate turns สำหรับคัด/label |
| `build-report-lite.mjs` | ตัวสร้าง `report.html` (copy จาก skill ให้รันได้โดยไม่ต้องลง skill) |
| `.claude/hillclimb/pp-customer/` | ผลรัน: `_state.json` (metrics/perf/harness) · `baseline/`, `v1/` … (`results.jsonl`, `traces/`, `errors.jsonl`) |

## Metrics (ต่อเคส, binary)

กฎแข็ง (โค้ด): `pass` = ทุกข้อด้านล่างผ่าน · `outcome` (quote/ask/escalate/template/table ตรง label) · `tool_spec` (เรียก `compute_quote` ด้วยสเปกที่คาด ไม่เรียกมั่วบนเทิร์นที่ต้องถาม) · `prices` (ทุก "N บาท" ในคำตอบมาจากผล tool ของเทิร์นนี้) · `format` (ไม่มี markdown · มี VAT note + disclaimer เมื่อตีราคา · วลีส่งต่อเฉพาะตอนส่งต่อจริง · 📊 เฉพาะเมื่อส่งตาราง) · `asks` (regex ห้ามถาม/ต้องถามต่อเคส) · `refused`

กรรมการ (Claude Fable 5.1 — อิสระจากทั้ง Sonnet/Opus ที่เทียบ): `judge_missing` ถามเฉพาะที่ขาดจริง · `judge_concise` กระชับ · `judge_register` ภาษาสุภาพแบบร้าน ไม่มีศัพท์ภายใน

Perf: `latency_s` (ทั้งเทิร์นรวม tool) · `tool_calls` · `rounds` · `out_chars` · `out_lines` · usage → cost คำนวณตอนสรุป
