'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { AnalyticsResult } from '@/lib/analytics';

const ACCENT = '#c8553d';
const BLUE = '#3b82f6';
const GREEN = '#10b981';
const NAVY = '#1e3a8a';
const PURPLE = '#a855f7';
const AMBER = '#f59e0b';

// ─── Orders trend (bar) ─────────────────────────────────────

export function OrdersTrendChart({ trend }: { trend: AnalyticsResult['trend'] }) {
  return (
    <ChartCard title="📈 ใบสั่งใหม่ vs จัดส่ง">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={trend} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#a8a29e" />
          <YAxis tick={{ fontSize: 11 }} stroke="#a8a29e" allowDecimals={false} />
          <Tooltip cursor={{ fill: '#f5f5f4' }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="newOrders" name="ใบสั่งใหม่" fill={BLUE} radius={[4, 4, 0, 0]} />
          <Bar dataKey="shipped" name="จัดส่งสำเร็จ" fill={GREEN} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ─── Turnaround (line) ──────────────────────────────────────

export function TurnaroundChart({ trend }: { trend: AnalyticsResult['trend'] }) {
  return (
    <ChartCard title="⏱ เวลารับ→ส่ง เฉลี่ย (วัน)">
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={trend} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#a8a29e" />
          <YAxis tick={{ fontSize: 11 }} stroke="#a8a29e" />
          <Tooltip cursor={{ fill: '#f5f5f4' }} formatter={(v) => [`${v} วัน`, 'เฉลี่ย']} />
          <Line
            type="monotone"
            dataKey="turnaround"
            name="เฉลี่ย (วัน)"
            stroke={ACCENT}
            strokeWidth={2.5}
            dot={{ fill: ACCENT, r: 3 }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ─── Top customers (horizontal bar) ─────────────────────────

export function TopCustomersChart({ data }: { data: AnalyticsResult['topCustomers'] }) {
  if (data.length === 0) {
    return (
      <ChartCard title="🏆 ลูกค้าที่สั่งงานบ่อยที่สุด (Top 10)">
        <div className="h-[260px] flex items-center justify-center text-stone-400 text-sm">
          ไม่มีข้อมูลในช่วงนี้
        </div>
      </ChartCard>
    );
  }
  // Truncate long names for display
  const formatted = data.map(d => ({
    ...d,
    displayName: d.name.length > 22 ? d.name.substring(0, 20) + '…' : d.name,
  }));
  return (
    <ChartCard title="🏆 ลูกค้าที่สั่งงานบ่อยที่สุด (Top 10)">
      <ResponsiveContainer width="100%" height={Math.max(260, data.length * 28 + 40)}>
        <BarChart data={formatted} layout="vertical" margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
          <XAxis type="number" tick={{ fontSize: 11 }} stroke="#a8a29e" allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="displayName"
            tick={{ fontSize: 11 }}
            stroke="#a8a29e"
            width={140}
          />
          <Tooltip cursor={{ fill: '#f5f5f4' }} formatter={(v) => [`${v} ใบ`, 'จำนวน']} />
          <Bar dataKey="count" name="จำนวนใบสั่ง" fill={NAVY} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ─── Dept workload (doughnut) ───────────────────────────────

export function DeptWorkloadChart({ data }: { data: AnalyticsResult['deptWorkload'] }) {
  const total = data.graphic + data.print + data.post;
  if (total === 0) {
    return (
      <ChartCard title="🎯 งานในระบบตอนนี้ ตามแผนก">
        <div className="h-[260px] flex items-center justify-center text-stone-400 text-sm">
          ไม่มีงาน active
        </div>
      </ChartCard>
    );
  }
  const pieData = [
    { name: 'กราฟิก', value: data.graphic, fill: PURPLE },
    { name: 'พิมพ์', value: data.print, fill: AMBER },
    { name: 'หลังพิมพ์/จัดส่ง', value: data.post, fill: GREEN },
  ].filter(d => d.value > 0);

  return (
    <ChartCard title="🎯 งานในระบบตอนนี้ ตามแผนก">
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Tooltip formatter={(v) => [`${v} งาน`, '']} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Pie
            data={pieData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={90}
            paddingAngle={2}
            label={({ name, value }: { name?: string; value?: number }) => `${name}: ${value}`}
          >
            {pieData.map(d => (
              <Cell key={d.name} fill={d.fill} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ─── Card wrapper ───────────────────────────────────────────

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-stone-200 p-5">
      <h3 className="text-sm font-medium text-stone-700 mb-3">{title}</h3>
      {children}
    </div>
  );
}
