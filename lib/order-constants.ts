/**
 * Order-form "ผู้สั่งงาน" dropdown options — mirrors WP `ORDERERS` const
 * in production-monitoring.js:1390. Keep in sync with WP.
 * No 'server-only': imported by the client order form and server code alike.
 */
export const ORDERERS: readonly string[] = ['นุ๊ก', 'กิ๊ฟ', 'เจี๊ยบ'];

/** Quantity unit options for the order form. */
export const QTY_UNITS: readonly string[] = ['แผ่น', 'ชุด', 'เล่ม', 'กล่อง', 'ถุง', 'ห่อ', 'ชิ้น', 'ซอง', 'แฟ้ม'];
