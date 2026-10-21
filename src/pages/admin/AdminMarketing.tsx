import React, { useEffect, useState } from 'react';
import { adminGet, adminSend } from '../../services/adminApi';
import { useAuth } from '../../context/AuthContext';
import { ErrorNote, LoadingNote, PageTitle, dangerBtn, ghostBtn, inputCls, labelCls, primaryBtn } from '../../components/admin/ui';

interface Coupon { id: string; code: string; type: 'percent' | 'fixed'; value: number; isActive: boolean; expiresAt: string | null }

export default function AdminMarketing() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [rows, setRows] = useState<Coupon[]>([]);
  const [form, setForm] = useState({ code: '', type: 'percent' as 'percent' | 'fixed', value: 10, expiresAt: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = () => { adminGet<{ coupons: Coupon[] }>('/api/v1/admin/coupons').then((d) => setRows(d.coupons)).catch((e: Error) => setError(e.message)); };
  useEffect(load, []);
  const create = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setNotice('');
    try {
      await adminSend('POST', '/api/v1/admin/coupons', {
        code: form.code, type: form.type, value: form.value, isActive: true,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
      });
      setForm({ code: '', type: 'percent', value: 10, expiresAt: '' });
      setNotice('Coupon created.'); load();
    } catch (err) { setError((err as Error).message); }
  };
  const toggle = async (c: Coupon) => {
    try { await adminSend('PATCH', `/api/v1/admin/coupons/${c.id}`, { isActive: !c.isActive }); load(); }
    catch (e) { setError((e as Error).message); }
  };
  const remove = async (id: string) => {
    try { await adminSend('DELETE', `/api/v1/admin/coupons/${id}`); load(); }
    catch (e) { setError((e as Error).message); }
  };
  return (
    <div>
      <PageTitle sub="Discount codes customers can use at checkout">Marketing — Coupons</PageTitle>
      {error && <ErrorNote message={error} />}
      {notice && <p className="font-bodytext text-sm text-[#4ade80] mb-4">{notice}</p>}
      {isAdmin ? (
        <form onSubmit={create} className="bg-[#1C2B1E] border border-white/10 p-6 mb-10 grid md:grid-cols-4 gap-4 items-end">
          <div><label className={labelCls} htmlFor="c-code">Code</label><input id="c-code" className={inputCls} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required minLength={3} /></div>
          <div><label className={labelCls} htmlFor="c-type">Type</label>
            <select id="c-type" className={inputCls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as 'percent' | 'fixed' })}>
              <option value="percent">Percent off</option><option value="fixed">Fixed amount</option>
            </select></div>
          <div><label className={labelCls} htmlFor="c-value">Value</label><input id="c-value" type="number" min="0" step="0.01" className={inputCls} value={form.value} onChange={(e) => setForm({ ...form, value: Number(e.target.value) })} required /></div>
          <div><label className={labelCls} htmlFor="c-exp">Expires (optional)</label><input id="c-exp" type="date" className={inputCls} value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></div>
          <button type="submit" className={primaryBtn}>Create coupon</button>
        </form>
      ) : (
        <p className="font-bodytext text-sm text-[#F5F0E8]/50 mb-8">Only admins can create or change coupons.</p>
      )}
      {rows.length === 0 && !error && <LoadingNote />}
      <div className="space-y-3">
        {rows.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 bg-[#1C2B1E] border border-white/10 px-5 py-4">
            <p className="font-bodytext text-sm tracking-[0.15em]">{c.code} <span className="text-[#F5F0E8]/50 tracking-normal">— {c.type === 'percent' ? `${c.value}% off` : `$${c.value} off`}{c.expiresAt ? ` · expires ${new Date(c.expiresAt).toLocaleDateString()}` : ''} · {c.isActive ? 'Active' : 'Inactive'}</span></p>
            {isAdmin && (
              <div className="flex gap-2">
                <button className={ghostBtn} onClick={() => void toggle(c)}>{c.isActive ? 'Deactivate' : 'Activate'}</button>
                <button className={dangerBtn} onClick={() => void remove(c.id)}>Delete</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
