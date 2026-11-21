/**
 * SQL of the one-shot Peak marker repair (2026-11-21) — text only, no imports, so it can also
 * be run as it is on a scratch Postgres. Executed by lib/peak-order/marker-backfill.ts.
 *
 * Source of truth for a lost marker: peak_order_drafts. The draft that created an order keeps,
 * in `units[]`, the unit's `lineKeys` and `result = { kind: 'order' | 'draft', orderId }`, the
 * draft row has the quotation code, and no code deletes drafts — so
 * { code: d.qo_code, lineKeys: u.lineKeys, draftId: d.id } is exactly what
 * lib/peak-order/mapper.ts wrote into raw_data.peak when the order was created.
 * Units the rebuild does not use: 'skipped' (no order) and 'existing' (the unit adopted an
 * order — another draft's, or its own after a create that half-failed). Orders reachable only
 * that way, or only through a link row, are listed by UNSEEN_SQL for a person; nothing guesses
 * a marker for them.
 *
 * Not peak_order_links: when `/order` opens a dead order's line again, the link row moves to
 * the newer order — the old order would get a narrower marker, or none (independent review).
 *
 * No statement here takes a parameter.
 */

/** One row per draft unit that created an order: (order, quotation, draft, line keys). */
const UNITS = `
  SELECT CASE WHEN u->'result'->>'orderId' ~ '^[0-9]{1,18}$'
              THEN (u->'result'->>'orderId')::bigint END AS order_id,
         d.qo_code, d.id AS draft_id, u->'lineKeys' AS line_keys
    FROM peak_order_drafts d
   CROSS JOIN LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(d.units) = 'array' THEN d.units ELSE '[]'::jsonb END) AS u
   WHERE u->'result'->>'kind' IN ('order', 'draft')
     AND CASE WHEN jsonb_typeof(u->'lineKeys') = 'array' THEN jsonb_array_length(u->'lineKeys') ELSE 0 END > 0`;

/** One marker per order. An order that two units say they created is left out — never a guess. */
const SOURCE = `
  src AS (${UNITS}),
  m AS (
    SELECT order_id, MIN(qo_code) AS qo_code, MIN(draft_id) AS draft_id, (array_agg(line_keys))[1] AS line_keys
      FROM src
     WHERE order_id IS NOT NULL
     GROUP BY order_id
    HAVING COUNT(*) = 1
  )`;

/** The marker as lib/peak-order/mapper.ts writes it. */
const MARKER = `jsonb_build_object('code', m.qo_code, 'lineKeys', m.line_keys, 'draftId', m.draft_id)`;

/** Every snapshot that takes the marker is a JSON object (a NULL or a missing key makes this NULL = not patchable). */
const OBJECTS = `jsonb_typeof(o.raw_data) = 'object'
     AND jsonb_typeof(o.details) = 'object'
     AND jsonb_typeof(o.raw) = 'object'
     AND jsonb_typeof(o.raw->'rawData') = 'object'
     AND jsonb_typeof(o.raw->'details') = 'object'`;

/** Read-only: orders a draft created that have no marker object now. */
export const SCAN_MISSING_SQL = `
  WITH ${SOURCE}
  SELECT o.id::text AS order_id, o.name, o.status, m.qo_code, m.draft_id, m.line_keys,
         (${OBJECTS}) AS patchable
    FROM m
    JOIN orders o ON o.id = m.order_id
   WHERE jsonb_typeof(o.raw_data->'peak') IS DISTINCT FROM 'object'
   ORDER BY o.id`;

/** Read-only control: orders that still have their marker — is the rebuilt one the same? */
export const CONTROL_SQL = `
  WITH ${SOURCE}
  SELECT o.id::text AS order_id, o.raw_data->'peak' AS stored, ${MARKER} AS rebuilt,
         (o.raw_data->'peak' = ${MARKER}) AS same
    FROM m
    JOIN orders o ON o.id = m.order_id
   WHERE jsonb_typeof(o.raw_data->'peak') = 'object'
   ORDER BY o.id`;

/** Read-only: orders that more than one draft unit says it created (left out of the repair). */
export const AMBIGUOUS_SQL = `
  WITH src AS (${UNITS})
  SELECT order_id::text AS order_id
    FROM src
   WHERE order_id IS NOT NULL
   GROUP BY order_id
  HAVING COUNT(*) > 1
   ORDER BY order_id`;

/**
 * Read-only: orders with no marker object that `/order` knows about some other way and that the
 * repair does NOT rebuild — a link row points at them, or a unit adopted them (`result.kind =
 * 'existing'`: after a create that half-failed this is the draft's own order; the unit of a
 * create whose result write failed has no result at all, and only its link row shows it).
 * For a person to look at. An empty "missing" list alone does not mean nothing is left.
 */
export const UNSEEN_SQL = `
  WITH ${SOURCE},
  hint AS (
    SELECT l.order_id, 'link' AS via, l.qo_code FROM peak_order_links l WHERE l.order_id IS NOT NULL
    UNION
    SELECT CASE WHEN u->'result'->>'orderId' ~ '^[0-9]{1,18}$'
                THEN (u->'result'->>'orderId')::bigint END AS order_id,
           'existing-unit' AS via, d.qo_code
      FROM peak_order_drafts d
     CROSS JOIN LATERAL jsonb_array_elements(
             CASE WHEN jsonb_typeof(d.units) = 'array' THEN d.units ELSE '[]'::jsonb END) AS u
     WHERE u->'result'->>'kind' = 'existing'
  )
  SELECT o.id::text AS order_id, o.name, o.status, MIN(h.qo_code) AS qo_code,
         array_agg(DISTINCT h.via ORDER BY h.via) AS via
    FROM hint h
    JOIN orders o ON o.id = h.order_id
   WHERE jsonb_typeof(o.raw_data->'peak') IS DISTINCT FROM 'object'
     AND NOT EXISTS (SELECT 1 FROM m WHERE m.order_id = o.id)
   GROUP BY o.id, o.name, o.status
   ORDER BY o.id`;

/**
 * The repair — ONE statement. The preconditions (still no marker object; every snapshot that
 * takes it is a JSON object) are in the UPDATE's WHERE: an order that got a marker since the
 * scan is left alone, and a second run restores nothing.
 */
export const APPLY_SQL = `
  WITH ${SOURCE},
  p AS (
    SELECT m.order_id, m.qo_code, m.draft_id, m.line_keys, jsonb_build_object('peak', ${MARKER}) AS patch
      FROM m
  )
  UPDATE orders o SET
    raw_data = o.raw_data || p.patch,
    details = o.details || p.patch,
    raw = o.raw || jsonb_build_object(
      'rawData', (o.raw->'rawData') || p.patch,
      'details', (o.raw->'details') || p.patch)
    FROM p
   WHERE o.id = p.order_id
     AND jsonb_typeof(o.raw_data->'peak') IS DISTINCT FROM 'object'
     AND ${OBJECTS}
  RETURNING o.id::text AS order_id, o.name, o.status, p.qo_code, p.draft_id, p.line_keys`;
