import { Sidebar } from './sidebar';
import { BottomNav } from './bottom-nav';
import { ToastProvider } from './toast-provider';
import { ConfirmProvider } from './confirm-provider';

interface ShellProps {
  user: string;
  role: string;
  children: React.ReactNode;
}

/** Shared shell for authenticated pages — sidebar (desktop) + bottom-nav
 *  (mobile) + main content area with offset for the sidebar.
 *
 *  Server component — passes session info to client nav components. Drop
 *  in to /board, /analytics, /calendar, /archive. The home page (/) and
 *  /login don't use this shell. */
export function DashboardShell({ user, role, children }: ShellProps) {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <div className="min-h-screen bg-stone-50">
          <Sidebar user={user} role={role} />
          <BottomNav role={role} />
          {/* Offsets: 220px sidebar on desktop; 64px bottom-nav on mobile */}
          <div className="md:pl-[220px] pb-20 md:pb-0">{children}</div>
        </div>
      </ConfirmProvider>
    </ToastProvider>
  );
}
