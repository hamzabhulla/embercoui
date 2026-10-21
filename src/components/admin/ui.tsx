import React from 'react';

export function PageTitle({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-8">
      <h1 className="font-display text-4xl mb-1">{children}</h1>
      {sub && <p className="font-bodytext text-sm text-[#F5F0E8]/50">{sub}</p>}
    </div>
  );
}

export function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-[#1C2B1E] border border-white/10 p-5">
      <p className="font-bodytext text-[10px] tracking-[0.25em] uppercase text-[#F5F0E8]/50 mb-2">{label}</p>
      <p className="font-display text-3xl">{value}</p>
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div role="alert" className="border border-[#ef4444]/50 bg-[#ef4444]/10 text-[#ef4444] px-4 py-3 font-bodytext text-sm mb-6">{message}</div>
  );
}

export function LoadingNote() {
  return <p className="font-bodytext text-[#F5F0E8]/50 text-sm">Loading…</p>;
}

export const inputCls = 'w-full bg-white/5 border border-white/15 px-3 py-2.5 font-bodytext text-sm text-[#F5F0E8] placeholder-[#F5F0E8]/30 focus:outline-none focus:border-[#C17A3A]';
export const labelCls = 'block font-bodytext text-[10px] tracking-[0.22em] uppercase text-[#F5F0E8]/60 mb-1.5';
export const primaryBtn = 'px-5 py-2.5 bg-[#C17A3A] hover:bg-[#A66932] text-white font-bodytext text-xs tracking-[0.18em] uppercase transition-colors disabled:opacity-50';
export const ghostBtn = 'px-4 py-2 border border-white/20 font-bodytext text-[11px] tracking-[0.15em] uppercase hover:bg-white/5 transition-colors disabled:opacity-50';
export const dangerBtn = 'px-4 py-2 border border-[#ef4444]/50 text-[#ef4444] font-bodytext text-[11px] tracking-[0.15em] uppercase hover:bg-[#ef4444]/10 transition-colors disabled:opacity-50';

export function money(n: number) {
  return `$${n.toFixed(2)}`;
}

export function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function StatusPill({ status }: { status: string }) {
  const cancelled = status === 'cancelled';
  const done = status === 'delivered' || status === 'confirmed' || status === 'completed' || status === 'paid';
  return (
    <span className={`inline-block px-2.5 py-1 font-bodytext text-[10px] tracking-[0.15em] uppercase border ${cancelled ? 'border-[#ef4444]/50 text-[#ef4444]' : done ? 'border-[#4ade80]/50 text-[#4ade80]' : 'border-[#C17A3A]/60 text-[#C17A3A]'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}
