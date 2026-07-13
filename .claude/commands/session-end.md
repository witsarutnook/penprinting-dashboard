---
description: ปิด session — update NEXT-SESSION + dashboard-v2 + AUDIT-BACKLOG + commit/push + แจ้ง pending actions (ฉบับ in-repo ใช้ได้บน iPad/cloud)
argument-hint: "(optional) summary brief ของ session — ถ้าไม่ใส่ผมสรุปเอง"
---

> ฉบับ in-repo สำหรับ cloud/iPad session — ต้นฉบับระดับ workspace อยู่ที่ `../.claude/commands/session-end.md` บนเครื่อง Mac. แก้ checklist ที่ไหนให้ sync อีกที่ด้วย.

ก่อนปิด session ต้องทำ documentation discipline:

## Step 1 — Sanity check uncommitted changes

`git status`:
- ถ้ามี code changes ที่ยัง uncommit → **ห้ามปิด session** จนกว่าจะ commit + push
- ถ้ามี untracked test/scratch files → ถามคุณนุ๊กว่าจะ keep หรือ delete

## Step 2 — Update NEXT-SESSION.md

Append session entry ที่ top (เหนือ entry ก่อนหน้า):
- **วันที่ + title** — ระบุด้วยว่าเป็น **cloud/iPad session** (session เครื่อง Mac จะได้รู้ที่มา commit)
- **สิ่งที่ทำ** + commit hashes
- **Deferred items** (พร้อมเหตุผล)
- **User actions queued** (Apps Script, env vars, smoke tests)
- **Lessons learned** (ถ้ามี)

## Step 3 — Update dashboard-v2.md (ถ้าแตะ feature/architecture สำคัญ)

เพิ่ม entry ใน Version History section (เหนือ entry ก่อนหน้า)

## Step 4 — Update AUDIT-BACKLOG.md (ถ้าปิด audit item)

Tick + ✅ + commit hash + update header summary

## Step 5 — Memory lesson (cloud session ทำแทนด้วยวิธีนี้)

> Memory files อยู่บนเครื่อง Mac (`~/.claude/projects/.../memory/`) — cloud session **เขียนไม่ได้**.
> ถ้าเจอ lesson ที่อาจ recur: เขียนลง NEXT-SESSION entry พร้อม tag **`[MEMORY-QUEUE]`** — session เครื่อง Mac ถัดไปเห็นแล้วให้ save เข้า memory จริง + ลบ tag

## Step 6 — Commit + push

- Stage เฉพาะไฟล์ที่เกี่ยว (อย่าใช้ `git add -A`)
- Commit message focus on **why** — HEREDOC for formatting
- `git push` — Vercel auto-deploy

## Step 7 — Surface session summary + pending actions

ตอบคุณนุ๊กด้วย: commits today · audit items closed · docs updated · ⚠️ pending user actions · queued for next session

---

Session summary brief (ถ้าใส่): $ARGUMENTS
