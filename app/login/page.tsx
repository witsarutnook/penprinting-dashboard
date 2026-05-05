import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from './form';

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
            Penprinting Dashboard — สำหรับเจ้าหน้าที่
          </p>
        </div>
        <Suspense fallback={<div className="h-32" />}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
