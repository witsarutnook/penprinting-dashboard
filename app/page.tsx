import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE_NAME, verifySession } from '@/lib/auth';

/**
 * Root route — no landing splash, no feature picker. The previous
 * "Phase 3.1 strangler scaffold" hero was useful while bootstrapping
 * but became dead weight once /board is the actual workspace.
 *
 * Behavior:
 *   - Logged out → /login
 *   - Logged in  → /board  (the default workspace for every role)
 *
 * Redirect happens server-side so users never see this component
 * paint. Update the destination here if a different default landing
 * is wanted (e.g. /analytics for admins).
 */
export default async function Home() {
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) redirect('/login');
  redirect('/board');
}
