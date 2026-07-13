---
description: เริ่ม session ใหม่ — context check จาก docs + git + pending user actions ก่อนเริ่มงานจริง (ฉบับ in-repo ใช้ได้บน iPad/cloud)
argument-hint: "(optional) focus ของวันนี้"
---

> ฉบับ in-repo สำหรับ cloud/iPad session (clone เฉพาะ repo นี้) — ต้นฉบับระดับ workspace อยู่ที่ `../.claude/commands/session-start.md` บนเครื่อง Mac. แก้ checklist ที่ไหนให้ sync อีกที่ด้วย.

ทำ context check ก่อนเริ่มงาน (ตาม Session Discipline):

## Step 1 — อ่าน pick-up docs

1. `NEXT-SESSION.md` — session ล่าสุดทำอะไรไป / เหลืออะไร / lessons learned (อ่านส่วนบนสุด, ~50 บรรทัด)
2. `AUDIT-BACKLOG.md` — open items + recent closures (อ่าน header summary)

## Step 2 — Recent git activity

`git log --oneline -10` + `git status` ใน repo นี้ — เทียบกับที่ NEXT-SESSION เล่า ถ้ามี commit ที่ doc ไม่รู้จัก (เช่นจาก session เครื่องอื่น) ให้ surface

## Step 3 — Source-of-truth docs (ถ้างานแตะ feature/architecture)

อ่าน `dashboard-v2.md` section ที่เกี่ยว (routes / features / version history) + `PATTERNS.md` ถ้าจะ reuse pattern

> หมายเหตุ cloud session: ไฟล์ระดับ workspace (`Tech-Roadmap-Status.md`, subproject อื่น เช่น penprinting-web / print-calculator-next) **ไม่อยู่ใน clone นี้** — ถ้างานต้องแตะ ให้บอกคุณนุ๊กว่าต้องทำจากเครื่อง Mac

## Step 4 — Pending user actions

จาก NEXT-SESSION.md ดูว่ามี **pending user actions** ค้างมั้ย:
- Smoke tests ที่ยังไม่ verify
- Apps Script deploys ที่รอ user push
- Env vars ที่ต้อง user setup

## Step 5 — Surface findings → confirm direction

สรุปสั้นๆ (≤200 คำ):
- **Where we left off**: session ก่อนทำอะไรเสร็จ
- **Pending user actions**: รายการที่ user ค้างต้องทำเอง
- **Top deferred items**: 2-3 รายการที่ขึ้น backlog
- **Suggested focus today**: 1-2 options ตาม backlog

แล้วถามคุณนุ๊กว่าจะเอาทางไหน — **ห้ามเริ่มแก้โค้ดก่อน user confirm**

---

Focus area (ถ้ามี): $ARGUMENTS
