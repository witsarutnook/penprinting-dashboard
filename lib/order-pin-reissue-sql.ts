/**
 * SQL of the one-shot PIN reissue (lib/order-pin-reissue.ts). No imports, so the text can be run
 * as it is on a real Postgres outside the test suite (the suite mocks the SQL layer).
 */

/** The order `o` holds no PIN in any of the four places one can be (blank text is not a PIN). */
export const NO_PIN = `COALESCE(
    NULLIF(btrim(o.raw_data->>'pin'), ''), NULLIF(btrim(o.details->>'pin'), ''),
    NULLIF(btrim(o.raw #>> '{rawData,pin}'), ''), NULLIF(btrim(o.raw #>> '{details,pin}'), '')) IS NULL`;

/** The five places the write touches (`raw` and the four snapshots). */
const SNAPSHOTS = ['o.raw', 'o.raw_data', 'o.details', "o.raw->'rawData'", "o.raw->'details'"];

/**
 * The order `o` gets a new PIN: it has none, it is in production (sent, not shipped, not
 * cancelled, with a live job), and every snapshot the write touches IS a JSON object.
 * ONE definition — the dry run reports it and the write is gated by it.
 *
 * Objects are required, not merely tolerated (independent review 2026-11-27): readers take
 * `rawData` when it is an object and only then `details`, so a `{pin}` made where there was
 * nothing would stand in front of a spec that lives in the other snapshot. An order the bug
 * wiped has all of them by construction (the edit wrote the same snapshot into each); anything
 * else is reported by the dry run as not eligible and left alone.
 */
export const ELIGIBLE = `(${NO_PIN})
    AND COALESCE(o.status, '') = 'sent'
    AND NOT EXISTS (SELECT 1 FROM shipped s WHERE s.order_id = o.id)
    AND NOT EXISTS (SELECT 1 FROM cancelled c WHERE c.order_id = o.id)
    AND EXISTS (SELECT 1 FROM jobs j WHERE j.order_id = o.id AND j.phase2_deleted_at IS NULL)
    AND ${SNAPSHOTS.map((x) => `jsonb_typeof(${x}) = 'object'`).join('\n    AND ')}`;

/** Dry run: every order without a PIN, and whether the write would give it one. Reads only. */
export const SCAN_SQL = `
  SELECT o.id, o.name, o.customer, o.status, o.date_due,
         (SELECT COUNT(*) FROM jobs j WHERE j.order_id = o.id AND j.phase2_deleted_at IS NULL)::int AS live_jobs,
         EXISTS (SELECT 1 FROM shipped s WHERE s.order_id = o.id) AS shipped,
         EXISTS (SELECT 1 FROM cancelled c WHERE c.order_id = o.id) AS cancelled,
         COALESCE((${ELIGIBLE}), FALSE) AS eligible
    FROM orders o
   WHERE ${NO_PIN}
   ORDER BY o.id`;

/**
 * The write: ONE statement. $1 = JSON array of { id, pin }. A row is touched only while it is
 * still eligible (the gate is in the WHERE), so a second run — or a row that got a PIN in the
 * meantime — changes nothing. The PIN goes into raw_data, details and both copies inside raw;
 * every one of them is an object (the gate), so `||` only sets the one key.
 */
export const ISSUE_SQL = `
  UPDATE orders o SET
    raw_data = o.raw_data || jsonb_build_object('pin', p.pin),
    details  = o.details || jsonb_build_object('pin', p.pin),
    raw      = o.raw || jsonb_build_object(
                 'rawData', (o.raw->'rawData') || jsonb_build_object('pin', p.pin),
                 'details', (o.raw->'details') || jsonb_build_object('pin', p.pin))
    FROM jsonb_to_recordset($1::jsonb) AS p(id bigint, pin text)
   WHERE o.id = p.id
     AND p.pin ~ '^[0-9]{4}$'
     AND ${ELIGIBLE}
  RETURNING o.id`;
