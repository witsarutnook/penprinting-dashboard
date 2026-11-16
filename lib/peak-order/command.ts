/**
 * Pure parser for the LINE `/order …` command. No 'server-only': imported by
 * the LINE channel, the webhook router and Flex builders.
 */
export type OrderCommand =
  | { kind: 'latest' }
  | { kind: 'code'; code: string }
  | { kind: 'digits'; digits: string }
  | { kind: 'text'; words: string[] };

const MAX_WORDS = 6;

/** `/order` followed by whitespace or end of text (after trim), case-insensitive. */
export function isOrderCommand(text: string): boolean {
  return /^\/order(\s|$)/i.test(text.trim());
}

/** Text after `/order`, trimmed ('' when not a command or no args). */
export function orderCommandArgs(text: string): string {
  const t = text.trim();
  if (!isOrderCommand(t)) return '';
  return t.slice('/order'.length).trim();
}

export function parseOrderCommand(text: string): OrderCommand | null {
  if (!isOrderCommand(text)) return null;
  const args = orderCommandArgs(text);
  if (args === '') return { kind: 'latest' };
  const code = /^QO-?(\d{6,})$/i.exec(args);
  if (code) return { kind: 'code', code: `QO-${code[1]}` };
  if (/^\d{3,}$/.test(args)) return { kind: 'digits', digits: args };
  const words = args.split(/\s+/).filter((w) => w !== '').slice(0, MAX_WORDS);
  return { kind: 'text', words };
}
