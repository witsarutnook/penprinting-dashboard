import 'server-only';
import { getPeakAccessToken } from '@/lib/peak/token-store';
import { PEAK_MCP_URL, PeakAuthError, PeakUnavailableError } from '@/lib/peak/oauth';

/**
 * Minimal Streamable-HTTP MCP client for Peak (read-only tools).
 * One client = one lazily created session. Never put the bearer token (or
 * upstream response bodies) into a thrown message.
 */

export type PeakToolName = 'get_quotation' | 'list_quotation' | 'search_contacts';
/** Tool returned isError, a JSON-RPC error, or content that is not JSON. */
export class PeakToolError extends Error {
  // explicit: constructor.name is mangled by production minification
  name = 'PeakToolError';
}

export interface PeakClient {
  call(name: PeakToolName, args: Record<string, unknown>): Promise<unknown>;
}

interface Deps {
  fetch?: typeof fetch;
  getToken?: (o?: { forceRefresh?: boolean }) => Promise<string>;
  timeoutMs?: number;
}

const PROTOCOL_VERSION = '2025-06-18';
const ALLOWED_TOOLS: readonly string[] = ['get_quotation', 'list_quotation', 'search_contacts'];
const MAX_ATTEMPTS = 3;

interface RpcMessage {
  id?: number | string | null;
  result?: { content?: Array<{ type?: string; text?: unknown }>; isError?: boolean };
  error?: { code?: unknown };
}

function parseSse(text: string): unknown[] {
  const out: unknown[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data) continue;
    try {
      out.push(JSON.parse(data));
    } catch {
      /* skip non-JSON event */
    }
  }
  return out;
}

export function createPeakClient(deps: Deps = {}): PeakClient {
  const f = deps.fetch ?? fetch;
  const getToken = deps.getToken ?? getPeakAccessToken;
  const timeoutMs = deps.timeoutMs ?? 10_000;

  let sessionId: string | null = null;
  let sessionPromise: Promise<string> | null = null;
  let nextId = 1;

  async function send(
    body: unknown,
    token: string,
    session: string | null,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
      'mcp-protocol-version': PROTOCOL_VERSION,
    };
    if (session) headers['mcp-session-id'] = session;
    try {
      return await f(PEAK_MCP_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new PeakUnavailableError('Peak MCP unreachable');
    }
  }

  async function readMessage(res: Response, id: number): Promise<RpcMessage> {
    let text: string;
    try {
      text = await res.text();
    } catch {
      throw new PeakUnavailableError('Peak MCP response interrupted');
    }
    const ct = res.headers.get('content-type') ?? '';
    let messages: unknown[];
    if (ct.includes('text/event-stream')) {
      messages = parseSse(text);
    } else {
      try {
        messages = [JSON.parse(text)];
      } catch {
        throw new PeakUnavailableError('Peak MCP returned an unreadable response');
      }
    }
    const flat = messages.flatMap((m) => (Array.isArray(m) ? m : [m]));
    const hit = flat.find((m) => (m as RpcMessage | null)?.id === id) as RpcMessage | undefined;
    if (!hit) throw new PeakUnavailableError('Peak MCP response had no matching message');
    return hit;
  }

  /** Throws for statuses that are never usable; 401/404 are handled by callers. */
  function failStatus(res: Response): never {
    if (res.status === 401 || res.status === 403) {
      throw new PeakAuthError(`Peak MCP rejected: ${res.status}`);
    }
    throw new PeakUnavailableError(`Peak MCP returned ${res.status}`);
  }

  async function initSession(token: string): Promise<string> {
    const id = nextId++;
    const res = await send(
      {
        jsonrpc: '2.0',
        id,
        method: 'initialize',
        params: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'penprinting-dashboard', version: '1' },
        },
      },
      token,
      null,
    );
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      if (res.status === 401) throw new PeakAuthError('Peak MCP rejected: 401');
      failStatus(res);
    }
    const sid = res.headers.get('mcp-session-id');
    const msg = await readMessage(res, id);
    if (msg.error) throw new PeakUnavailableError('Peak MCP initialize failed');
    if (!sid) throw new PeakUnavailableError('Peak MCP gave no session id');
    const note = await send({ jsonrpc: '2.0', method: 'notifications/initialized' }, token, sid);
    await note.body?.cancel().catch(() => undefined);
    if (!note.ok) {
      if (note.status === 401) throw new PeakAuthError('Peak MCP rejected: 401');
      failStatus(note);
    }
    return sid;
  }

  function ensureSession(token: string): Promise<string> {
    if (!sessionPromise) {
      const p = initSession(token).then(
        (sid) => {
          sessionId = sid;
          return sid;
        },
        (e) => {
          if (sessionPromise === p) sessionPromise = null;
          throw e;
        },
      );
      sessionPromise = p;
    }
    return sessionPromise;
  }

  function resetSession(used: string): void {
    if (sessionId === used) {
      sessionId = null;
      sessionPromise = null;
    }
  }

  async function call(name: PeakToolName, args: Record<string, unknown>): Promise<unknown> {
    if (!ALLOWED_TOOLS.includes(name)) {
      throw new Error(`Peak tool not allowed: ${String(name).slice(0, 40)}`);
    }
    let token = await getToken();
    let refreshed = false;
    let notFound = 0;

    for (;;) {
      let sid: string;
      try {
        sid = await ensureSession(token);
      } catch (e) {
        if (e instanceof PeakAuthError && !refreshed) {
          refreshed = true;
          token = await getToken({ forceRefresh: true });
          continue;
        }
        throw e;
      }

      const id = nextId++;
      const res = await send(
        { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } },
        token,
        sid,
      );

      if (res.status === 401) {
        await res.body?.cancel().catch(() => undefined);
        if (refreshed) throw new PeakAuthError('Peak MCP rejected the refreshed token');
        refreshed = true;
        token = await getToken({ forceRefresh: true });
        continue;
      }
      if (res.status === 404) {
        await res.body?.cancel().catch(() => undefined);
        resetSession(sid);
        notFound += 1;
        if (notFound >= MAX_ATTEMPTS) {
          throw new PeakUnavailableError('Peak MCP session could not be established');
        }
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        failStatus(res);
      }

      const msg = await readMessage(res, id);
      if (msg.error) {
        const code = typeof msg.error.code === 'number' ? msg.error.code : 'unknown';
        throw new PeakToolError(`Peak tool ${name} failed (rpc ${code})`);
      }
      const parts = Array.isArray(msg.result?.content) ? msg.result.content : [];
      const text = parts
        .map((p) => (typeof p?.text === 'string' ? p.text : ''))
        .join('');
      if (msg.result?.isError === true) {
        throw new PeakToolError(`Peak tool ${name} returned an error`);
      }
      try {
        return JSON.parse(text);
      } catch {
        throw new PeakToolError(`Peak tool ${name} returned non-JSON content`);
      }
    }
  }

  return { call };
}
