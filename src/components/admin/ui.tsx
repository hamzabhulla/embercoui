import React from 'react';
import { formatMoney } from '../../lib/currency';

/**
 * Admin design system — light, warm, minimal (matches the approved mockup).
 * Same export surface as the previous dark theme, plus a few primitives the
 * mockup uses (Card, FChip, Toggle, Avatar, SearchInput, chip buttons), so
 * every admin page speaks one visual language.
 */

export function PageTitle({ children, sub, actions }: { children: React.ReactNode; sub?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-4 mb-7">
      <div>
        <h1 className="font-display text-[31px] leading-[1.05] font-semibold text-[#16241A]">{children}</h1>
        {sub && (
          <p className="font-bodytext text-[12.5px] text-[#5C665C] mt-1.5 flex items-center gap-2">
            <span className="inline-block w-[7px] h-[7px] rounded-full bg-[#2E7D4F] shadow-[0_0_0_3px_#E9F4EC]" />
            {sub}
          </p>
        )}
      </div>
      {actions && <div className="ml-auto flex items-center gap-2.5 flex-wrap">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white border border-[#EAE3D3] rounded-[14px] shadow-[0_1px_2px_rgba(22,36,26,0.03),0_10px_24px_-18px_rgba(22,36,26,0.18)] ${className}`}>
      {children}
    </div>
  );
}

export function CardHead({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap px-[18px] pt-4 pb-3">
      <b className="font-bodytext text-[14.5px] font-semibold text-[#16241A]">{title}</b>
      {right}
    </div>
  );
}

export function StatCard({ label, value, foot }: { label: string; value: string | number; foot?: string }) {
  return (
    <div className="bg-white border border-[#EAE3D3] rounded-[14px] px-[18px] py-[17px] shadow-[0_1px_2px_rgba(22,36,26,0.03),0_10px_24px_-18px_rgba(22,36,26,0.18)]">
      <p className="font-bodytext text-[10px] tracking-[0.18em] uppercase text-[#98A096] font-semibold">{label}</p>
      <p className="font-bodytext text-[27px] leading-tight font-semibold text-[#16241A] mt-2 [font-variant-numeric:tabular-nums]">{value}</p>
      {foot && <p className="font-bodytext text-[11.5px] text-[#98A096] mt-1">{foot}</p>}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div role="alert" className="border border-[#B0492F]/40 bg-[#F9ECEC] text-[#B0492F] rounded-[10px] px-4 py-3 font-bodytext text-sm mb-6">{message}</div>
  );
}

export function NoticeNote({ message }: { message: string }) {
  return (
    <div role="status" className="border border-[#2E7D4F]/35 bg-[#E9F4EC] text-[#2E7D4F] rounded-[10px] px-4 py-3 font-bodytext text-sm mb-5">{message}</div>
  );
}

export function LoadingNote() {
  return <p className="font-bodytext text-[#98A096] text-sm py-6 text-center">Loading…</p>;
}

export function EmptyNote({ message }: { message: string }) {
  return <p className="font-bodytext text-[#98A096] text-sm py-8 text-center">{message}</p>;
}

export const inputCls = 'w-full bg-white border border-[#EAE3D3] rounded-[10px] px-3 py-2.5 font-bodytext text-[13.5px] text-[#16241A] placeholder-[#98A096] focus:outline-none focus:border-[#C17A3A] focus:shadow-[0_0_0_3px_rgba(193,122,58,0.15)]';
export const labelCls = 'block font-bodytext text-[10.5px] tracking-[0.14em] uppercase text-[#98A096] font-semibold mb-1.5';
export const primaryBtn = 'inline-flex items-center justify-center gap-2 px-4 h-[38px] rounded-[10px] bg-[linear-gradient(135deg,#C98A44,#A66932)] text-white font-bodytext text-[13px] font-semibold shadow-[0_8px_18px_-8px_rgba(166,105,50,0.65)] hover:brightness-105 transition disabled:opacity-50 cursor-pointer';
export const ghostBtn = 'inline-flex items-center justify-center gap-2 px-3.5 h-[38px] rounded-[10px] bg-white border border-[#EAE3D3] text-[#16241A] font-bodytext text-[13px] font-medium hover:bg-[#FBF8F1] transition disabled:opacity-50 cursor-pointer';
export const dangerBtn = 'inline-flex items-center justify-center gap-2 px-3.5 h-[38px] rounded-[10px] bg-white border border-[#B0492F]/45 text-[#B0492F] font-bodytext text-[13px] font-medium hover:bg-[#F9ECEC] transition disabled:opacity-50 cursor-pointer';
export const chipBtn = 'inline-flex items-center px-3 h-[30px] rounded-[8px] bg-[linear-gradient(135deg,#C98A44,#A66932)] text-white font-bodytext text-[12px] font-medium hover:brightness-105 transition disabled:opacity-50 cursor-pointer';
export const chipGhostBtn = 'inline-flex items-center px-3 h-[30px] rounded-[8px] bg-white border border-[#EAE3D3] text-[#16241A] font-bodytext text-[12px] font-medium hover:bg-[#FBF8F1] transition disabled:opacity-50 cursor-pointer';
export const chipDangerBtn = 'inline-flex items-center px-3 h-[30px] rounded-[8px] bg-white border border-[#B0492F]/45 text-[#B0492F] font-bodytext text-[12px] font-medium hover:bg-[#F9ECEC] transition disabled:opacity-50 cursor-pointer';

export function FChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`px-[13px] py-1.5 rounded-full border font-bodytext text-[12.5px] font-medium transition cursor-pointer ${active ? 'bg-[#16241A] border-[#16241A] text-[#F5F0E8]' : 'bg-white border-[#EAE3D3] text-[#5C665C] hover:bg-[#FBF8F1]'}`}>
      {children}
    </button>
  );
}

export function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick}
      className={`relative inline-block w-[38px] h-[22px] rounded-full transition-colors shrink-0 cursor-pointer ${on ? 'bg-[#2E7D4F]' : 'bg-[#DDD5BF]'}`}>
      <span className={`absolute top-[3px] w-4 h-4 rounded-full bg-white shadow transition-all ${on ? 'left-[19px]' : 'left-[3px]'}`} />
    </button>
  );
}

export function Avatar({ name, size = 30 }: { name: string; size?: number }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
  return (
    <span className="rounded-full bg-[#EFE9DB] text-[#8A551F] font-bodytext font-semibold inline-flex items-center justify-center shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.36 }}>
      {initials}
    </span>
  );
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <span className="inline-flex items-center gap-2 bg-white border border-[#EAE3D3] rounded-[10px] px-3 h-[38px] text-[#98A096] focus-within:border-[#C17A3A] focus-within:shadow-[0_0_0_3px_rgba(193,122,58,0.15)]">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder}
        className="bg-transparent outline-none border-none font-bodytext text-[13px] text-[#16241A] placeholder-[#98A096] w-[190px]" />
    </span>
  );
}

export const tableCls = 'w-full border-collapse';
export const thCls = 'text-left font-bodytext text-[10px] tracking-[0.16em] uppercase text-[#98A096] font-semibold px-[18px] pt-1.5 pb-2.5 border-b border-[#EFE9DB] whitespace-nowrap';
export const tdCls = 'px-[18px] py-3 border-b border-[#EFE9DB] align-middle font-bodytext text-[13.5px] text-[#16241A]';

export function money(n: number, currency = 'USD') {
  return formatMoney(n, currency);
}

export function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const PILL_TONES: Record<string, string> = {
  cancelled: 'bg-[#F9ECEC] text-[#B0492F]',
  failed: 'bg-[#F9ECEC] text-[#B0492F]',
  delivered: 'bg-[#E9F4EC] text-[#2E7D4F]',
  completed: 'bg-[#E9F4EC] text-[#2E7D4F]',
  paid: 'bg-[#E9F4EC] text-[#2E7D4F]',
  approved: 'bg-[#E9F4EC] text-[#2E7D4F]',
  confirmed: 'bg-[#E9F4EC] text-[#2E7D4F]',
  active: 'bg-[#E9F4EC] text-[#2E7D4F]',
  inactive: 'bg-[#EFE9DB] text-[#5C665C]',
  out_for_delivery: 'bg-[#E9F0F7] text-[#33608C]',
  ready: 'bg-[#E9F0F7] text-[#33608C]',
  refunded: 'bg-[#E9F0F7] text-[#33608C]',
};

export function StatusPill({ status }: { status: string }) {
  const tone = PILL_TONES[status] ?? 'bg-[#FAF1DC] text-[#B07C1E]';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-[3px] rounded-full font-bodytext text-[11px] font-semibold whitespace-nowrap ${tone}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {status.replace(/_/g, ' ')}
    </span>
  );
}
