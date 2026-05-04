// Shared types — mirror google-apps-script.js loadAll() response shape.
// Eventually will move to a shared monorepo package (Phase 2.4).

export interface Order {
  id: number;
  name: string;
  customer: string;
  dateIn: string;        // DD/MM/YYYY (entered by user)
  dateDue: string;
  price: string | number;
  assignDept: string;
  assignStaff: string;
  orderer: string;
  status: string;
  details?: Record<string, unknown>;
  rawData?: Record<string, unknown>;
}

export interface Job {
  id: number;
  name: string;
  date: string;
  dateIn: string;
  staff: string;
  dept: 'graphic' | 'print' | 'post' | string;
  status: string;
  orderId?: number;
  cowork?: unknown;
}

export interface Shipped {
  id: number;
  name: string;
  shippedDate: string;
  orderId: number | null;
}

export interface Cancelled {
  id: number;
  name: string;
  dept: string;
  staff: string;
  cancelledBy: string;
  cancelledAt: string;
  reason: string;
  orderId: number | null;
}

export interface Template {
  id: number;
  name: string;
  rawData?: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
}

export interface AuditEntry {
  timestamp: string;
  role: string;
  action: string;
  targetId: string;
  summary: string;
}

/** Response shape of GET ?action=loadAll */
export interface LoadAllResponse {
  jobs: Job[];
  orders: Order[];
  shipped: Shipped[];
  cancelled: Cancelled[];
  audit: AuditEntry[];
  nextId: number;
  templates: Template[];
}
