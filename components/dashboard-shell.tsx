import { Sidebar } from './sidebar';
import { BottomNav } from './bottom-nav';
import { MobileUserMenu } from './mobile-user-menu';
import { QuoteFab } from './quote-fab';
import { ToastProvider } from './toast-provider';
import { ConfirmProvider } from './confirm-provider';

interface ShellProps {
  user: string;
  role: string;
  children: React.ReactNode;
}

/** Shared shell for authenticated pages — sidebar (desktop) + bottom-nav
 *  + floating user menu (mobile) + main content area with offset for the
 *  sidebar.
 *
 *  Server component — passes session info to client nav components. Drop
 *  in to /board, /analytics, /calendar, /archive. The home page (/) and
 *  /login don't use this shell.
 *
 *  Accessibility: content wrapped in `<main id="main-content">` so screen
 *  readers can jump past the sidebar+nav via the landmark navigator, and
 *  a skip-to-content link (visible only on focus) appears as the first
 *  tab stop. (Auditor A11Y-R1 finding, 2026-05-12.) */
export function DashboardShell({ user, role, children }: ShellProps) {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <div className="min-h-screen bg-stone-50">
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-3 focus:py-2 focus:bg-accent focus:text-white focus:rounded-lg focus:shadow-lg"
          >
            ข้ามไปยังเนื้อหาหลัก
          </a>
          <Sidebar user={user} role={role} />
          <BottomNav role={role} />
          <MobileUserMenu user={user} role={role} />
          <QuoteFab role={role} />
          {/* Offsets: 220px sidebar on desktop; 64px bottom-nav on mobile */}
          <main id="main-content" tabIndex={-1} className="md:pl-[220px] pb-20 md:pb-0 outline-none">
            {children}
          </main>
        </div>
      </ConfirmProvider>
    </ToastProvider>
  );
}
