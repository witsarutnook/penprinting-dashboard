# Penprinting Dashboard

`dashboard.penprinting.co` — Next.js dashboard ใหม่ที่จะค่อยๆ ย้าย feature มาจาก WordPress dashboard เดิม (`app.penprinting.co/production-monitoring`) แบบ **strangler pattern**

## Stack
- **Next.js 14** (App Router) + TypeScript + Tailwind
- **Hosting**: Vercel (auto-deploy ทุก `git push`)
- **GitHub**: `witsarutnook/penprinting-dashboard` (private)
- **Font**: Anuphan (Thai) + Inter (numerals)
- **Brand color**: `#c8553d` (accent — เข้าชุดกับ penprinting-web + calc)

## Status (Phase 3.1 — scaffold only)
ตอนนี้เป็น **shell ขั้นต่ำ** — placeholder home + login. ระบบจริงยังอยู่ที่ WordPress

ดูแผน migration เต็มที่ memory `project_tech_roadmap_2026.md` หรือ workspace `CLAUDE.md`

## Roadmap
- **Phase 3.1** (current) — scaffold + auth wall placeholder
- **Phase 3.2** — port Analytics page (read-only) เป็น feature แรก
- **Phase 3.3** — port Calendar (read-only mobile)
- **Phase 3.4** — port Search archive (read-only)
- **Phase 3.5** (decision point) — port Kanban + order entry (write-heavy)
- **Phase 3.6** — decommission WordPress

## Dev
```bash
npm install
npm run dev          # localhost:3000
npm run type-check
npm run build        # verify before deploy
```

## Deploy
```bash
git add <files>
git commit -m "..."
git push             # Vercel auto-build
```

## Source-of-truth files
| File | Owns |
|---|---|
| `lib/seo.ts` → `SITE_CONFIG` | brand name, URL, default metadata |
| `app/layout.tsx` | Root layout + font setup |
| `tailwind.config.ts` | Design tokens (accent color, font family) |
