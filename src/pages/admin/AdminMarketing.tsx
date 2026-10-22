import React, { useCallback, useEffect, useState } from 'react';
import { adminGet, adminSend } from '../../services/adminApi';
import { useAuth } from '../../context/AuthContext';
import { useCurrency } from '../../context/CurrencyContext';
import { currencyExponent } from '../../lib/currency';
import { Card, DeleteButton, EmptyNote, ErrorNote, LoadingNote, NoticeNote, PageTitle, StatusPill, Toggle, ghostBtn, inputCls, labelCls, money, primaryBtn, tableCls, tdCls, thCls } from '../../components/admin/ui';

interface Coupon { id: string; code: string; type: 'percent' | 'fixed'; value: number; isActive: boolean; expiresAt: string | null }
const PAGE_SIZE = 100;

export default function AdminMarketing() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const { currency } = useCurrency();
  const [rows, setRows] = useState<Coupon[]>([]);
  const [total, setTotal] = useState(0);
  const [form, setForm] = useState({ code: '', type: 'percent' as 'percent' | 'fixed', value: 10, expiresAt: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const fetchPage = useCallback((offset: number, append: boolean) => {
    adminGet<{ coupons: Coupon[]; total: number }>(`/api/v1/admin/coupons?limit=${PAGE_SIZE}&offset=${offset}`)
      .then((d) => {
        setTotal(d.total);
        setRows((prev) => (append ? [...prev, ...d.coupons] : d.coupons));
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => { setLoaded(true); setLoadingMore(false); });
  }, []);
  const load = useCallback(() => fetchPage(0, false), [fetchPage]);
  useEffect(() => { load(); }, [load]);
  const loadMore = () => { setLoadingMore(true); fetchPage(rows.length, true); };
  const create = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setNotice('');
    // Percent means a share of the bill — over 100% is meaningless and
    // the server rejects it; catch it here with a clear message instead
    // of a failed round-trip (audit fix 15).
    if (form.type === 'percent' && form.value > 100) { setError('Percent coupons can be at most 100%.'); return; }
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
      <PageTitle sub="Discount codes customers can use at checkout">Coupons</PageTitle>
      {error && <ErrorNote message={error} />}
      {notice && <NoticeNote message={notice} />}
      {isAdmin ? (
        <form onSubmit={create} className="bg-white border border-[#EAE3D3] rounded-[14px] shadow-[0_1px_2px_rgba(22,36,26,0.03),0_10px_24px_-18px_rgba(22,36,26,0.18)] p-6 mb-8 grid md:grid-cols-4 gap-4 items-end">
          <div><label className={labelCls} htmlFor="c-code">Code</label><input id="c-code" className={inputCls} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required minLength={3} /></div>
          <div><label className={labelCls} htmlFor="c-type">Type</label>
            <select id="c-type" className={inputCls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as 'percent' | 'fixed' })}>
              <option value="percent">Percent off</option><option value="fixed">Fixed amount</option>
            </select></div>
          <div><label className={labelCls} htmlFor="c-value">Value{form.type === 'fixed' ? ` (${currency})` : ''}</label><input id="c-value" type="number" min="0" max={form.type === 'percent' ? 100 : undefined} step={form.type === 'fixed' ? 10 ** -currencyExponent(currency) : 0.01} className={inputCls} value={form.value} onChange={(e) => setForm({ ...form, value: Number(e.target.value) })} required /></div>
          <div><label className={labelCls} htmlFor="c-exp">Expires (optional)</label><input id="c-exp" type="date" className={inputCls} value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></div>
          <button type="submit" className={primaryBtn}>Create coupon</button>
        </form>
      ) : (
        <p className="font-bodytext text-[13.5px] text-[#5C665C] mb-8">Only admins can create or change coupons.</p>
      )}
      <Card className="overflow-hidden">
        {!loaded && !error && <LoadingNote />}
        {loaded && rows.length === 0 && !error && <EmptyNote message="No coupons yet." />}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead>
                <tr><th className={thCls}>Code</th><th className={thCls}>Discount</th><th className={thCls}>Expires</th><th className={thCls}>Status</th>{isAdmin && <th className={thCls}>Active</th>}{isAdmin && <th className={thCls}></th>}</tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="hover:bg-[#FDFBF7]">
                    <td className={tdCls}><span className="px-2.5 py-1 rounded-md bg-[#16241A] text-[#F5F0E8] font-mono text-[12px] tracking-[0.08em]">{c.code}</span></td>
                    <td className={`${tdCls} font-semibold`}>{c.type === 'percent' ? `${c.value}% off` : `${money(c.value, currency)} off`}</td>
                    <td className={`${tdCls} text-[#5C665C]`}>{c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : 'No expiry'}</td>
                    <td className={tdCls}><StatusPill status={c.isActive ? 'active' : 'inactive'} /></td>
                    {isAdmin && <td className={tdCls}><Toggle on={c.isActive} onClick={() => void toggle(c)} label={`${c.isActive ? 'Deactivate' : 'Activate'} coupon ${c.code}`} /></td>}
                    {isAdmin && <td className={tdCls}><span className="flex justify-end"><DeleteButton name={`coupon ${c.code}`} onDelete={() => void remove(c.id)} /></span></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {loaded && total > 0 && (
        <p className="font-bodytext text-[12.5px] text-[#98A096] mt-4">Showing {rows.length} of {total} coupons</p>
      )}
      {loaded && rows.length < total && (
        <div className="mt-3">
          <button type="button" className={ghostBtn} disabled={loadingMore} onClick={loadMore}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
