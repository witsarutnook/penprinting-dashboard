// lib/ai-quote/channels/types.ts
// Channel-agnostic inbound message + adapter contract. Phase 1b = LINE only;
// Messenger adds a second adapter implementing the same interface (Phase 1c).

export interface QuickReply {
  label: string;       // ปุ่มข้อความสั้น
  text: string;        // ข้อความที่ส่งกลับเมื่อกด
}

export type InboundKind = 'text' | 'image' | 'postback';

export interface InboundMessage {
  channel: 'line' | 'messenger';
  channelUserId: string;        // LINE userId / FB PSID — verified จาก webhook
  kind: InboundKind;
  text?: string;                // kind==='text'
  imageMessageId?: string;      // kind==='image' — LINE: message id (content API) / Messenger: attachment CDN URL
  postbackData?: string;        // kind==='postback'
  replyToken?: string;          // LINE reply token (Messenger ไม่มี → push by id)
  sourceType?: 'user' | 'group' | 'room';  // undefined = แชต 1-1 (user) — group/room เฉพาะคำสั่ง /groupid
  groupId?: string;             // sourceType==='group' (สำหรับตั้งค่า track ให้กลุ่มลูกค้า)
  roomId?: string;              // sourceType==='room'
}

export interface ChannelAdapter {
  /** Verify webhook authenticity (HMAC). Reject ก่อน process. */
  verifySignature(rawBody: string, signature: string): boolean;
  /** Parse provider webhook body → normalized messages (1-on-1 เท่านั้น). */
  parseEvents(body: unknown): InboundMessage[];
  /** ดึง bytes ของรูปจาก provider (สำหรับ slip). */
  downloadImage(msg: InboundMessage): Promise<Blob>;
  /** ตอบกลับ (ฟรีถ้ามี replyToken). message = text หรือ flex/object. */
  reply(msg: InboundMessage, message: string | object, quickReplies?: QuickReply[]): Promise<void>;
  /** ส่ง push by user id (เผื่อ reply token หมด / แจ้งทีหลัง). */
  push(channelUserId: string, text: string): Promise<void>;
}
