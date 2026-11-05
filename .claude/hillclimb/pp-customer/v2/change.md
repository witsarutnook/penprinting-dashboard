prompt v2: A6→A5 ÷2 / B5→A4 quoted at once · binding (ring +15 line, hard cover hands off) · lead-time/shipping no-number · format (no thinking-aloud/preamble, namecard one 💰 line, "ระบบ"/dash banned)
- grader: PROMPT_CONSTANTS (300 ค่าออกแบบ / 15 สันห่วง) context-bound; format fails on "ระบบ" and "- " — baseline + v1 regraded 2026-11-04 with the new grader AND relabelled s57-t2/s41-t2/s107-t0/s100-t6 (baseline pass 126 → 119/136; 125/154 with the 9 new cases)
- cases: +9 synthetic (sizes/binding/lead-time); baseline rows for them run with the pre-v2 prompt (approve #1, 6/18 pass)
- judge note: v2 judged with prompt v2 as <assistant_rules>, baseline with the 10/24 prompt — judge metrics compare across rule sets
- result 2026-11-05 (Sonnet ×2 reps, 154 rows): pass 151/154 (98.1%) vs baseline 125/154 (81.2%), paired +16.9 pts CI [8.3, 25.5]; 6 targets + 9 synth all 2/2; calendar/pvccard/scope 100% = baseline; namecard 23/26 (baseline 24/26)
- gate FAILED on one paired hard regression: s75-t0 (book "แบบเล่ม … กระดาษเคลือบมัน" quoted with Art 120 instead of asking inner gram — the new brochure "อาร์ตมัน = Art 120" rule leaked into books) → v3
