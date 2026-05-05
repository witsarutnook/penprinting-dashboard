import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-stone-50">
      <div className="text-center space-y-6 px-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 text-accent text-xs font-medium">
          <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
          Phase 3.1 — strangler scaffold
        </div>

        <h1 className="text-5xl md:text-6xl font-bold text-stone-900 tracking-tight">
          Penprinting Dashboard
        </h1>

        <p className="text-stone-600 max-w-md mx-auto leading-relaxed">
          ระบบติดตามการผลิตแบบใหม่ — กำลังย้ายมาจาก WordPress ทีละ feature ผ่านแบบ strangler pattern
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
          <Link
            href="/analytics"
            className="px-6 py-3 bg-accent text-white rounded-lg font-medium hover:bg-accent-dark transition-colors"
          >
            Analytics →
          </Link>
          <Link
            href="/calendar"
            className="px-6 py-3 bg-white text-stone-700 rounded-lg font-medium border border-stone-200 hover:border-stone-300 transition-colors"
          >
            Calendar →
          </Link>
          <a
            href="https://app.penprinting.co/production-monitoring/"
            className="px-6 py-3 bg-white text-stone-700 rounded-lg font-medium border border-stone-200 hover:border-stone-300 transition-colors"
          >
            ระบบเดิม (WP)
          </a>
        </div>

        <p className="text-xs text-stone-500 pt-2">
          <Link href="/login" className="hover:text-stone-700 underline">
            เข้าสู่ระบบ →
          </Link>
        </p>

        <p className="text-xs text-stone-400 pt-8">
          Stack: Next.js 14 · TypeScript · Tailwind · Vercel
        </p>
      </div>
    </main>
  );
}
