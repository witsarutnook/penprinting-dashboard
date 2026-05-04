import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'เข้าสู่ระบบ',
};

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-stone-200 p-8">
        <div className="space-y-1 mb-6">
          <h1 className="text-2xl font-bold text-stone-900">เข้าสู่ระบบ</h1>
          <p className="text-sm text-stone-500">
            สำหรับเจ้าหน้าที่เพ็ญพรินติ้ง
          </p>
        </div>

        {/* TODO: cookie-based HMAC auth — port pattern from page-production-monitoring.php */}
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900 space-y-2">
          <p className="font-medium">🚧 ระบบยังไม่พร้อมใช้</p>
          <p className="text-xs leading-relaxed">
            หน้านี้เป็น placeholder ระหว่างทำ Phase 3.1 (scaffold) — ระบบจริงยังอยู่ที่ WordPress dashboard เดิม
          </p>
        </div>

        <Link
          href="https://app.penprinting.co/production-monitoring/"
          className="block w-full mt-4 text-center px-4 py-3 bg-accent text-white rounded-lg font-medium hover:bg-accent-dark transition-colors"
        >
          ไปยังระบบเดิม
        </Link>

        <Link
          href="/"
          className="block w-full mt-2 text-center text-sm text-stone-500 hover:text-stone-700 py-2"
        >
          ← กลับหน้าแรก
        </Link>
      </div>
    </main>
  );
}
