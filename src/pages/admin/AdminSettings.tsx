import React, { useEffect, useState } from 'react';
import { adminGet, adminSend } from '../../services/adminApi';
import { ErrorNote, LoadingNote, PageTitle, inputCls, labelCls, primaryBtn } from '../../components/admin/ui';

interface Settings {
  kitchenOpen: boolean; waitMin: number; waitMax: number;
  restaurantName: string; phone: string | null; email: string | null; address: string | null;
  openingHours: Record<string, unknown>;
}

export default function AdminSettings() {
  const [form, setForm] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    adminGet<{ settings: Settings }>('/api/v1/admin/settings').then((d) => setForm(d.settings)).catch((e: Error) => setError(e.message));
  }, []);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const res = await adminSend<{ settings: Settings }>('PATCH', '/api/v1/admin/settings', {
        kitchenOpen: form.kitchenOpen, waitMin: form.waitMin, waitMax: form.waitMax,
        restaurantName: form.restaurantName, phone: form.phone, email: form.email, address: form.address,
        openingHours: form.openingHours,
      });
      setForm(res.settings);
      setNotice('Settings saved — the website header updates right away.');
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div>
      <PageTitle sub="The kitchen toggle and wait times drive the live status on the website">Settings</PageTitle>
      {error && <ErrorNote message={error} />}
      {notice && <p className="font-bodytext text-sm text-[#4ade80] mb-4">{notice}</p>}
      {!form && !error && <LoadingNote />}
      {form && (
        <form onSubmit={save} className="bg-[#1C2B1E] border border-white/10 p-6 grid md:grid-cols-2 gap-5 max-w-3xl">
          <label className="flex items-center gap-3 font-bodytext text-sm md:col-span-2">
            <input type="checkbox" checked={form.kitchenOpen} onChange={(e) => setForm({ ...form, kitchenOpen: e.target.checked })} className="accent-[#C17A3A] w-5 h-5" />
            Kitchen is open (shown live on the website)
          </label>
          <div><label className={labelCls} htmlFor="s-wmin">Minimum wait (minutes)</label><input id="s-wmin" type="number" min="0" max="240" className={inputCls} value={form.waitMin} onChange={(e) => setForm({ ...form, waitMin: Number(e.target.value) })} /></div>
          <div><label className={labelCls} htmlFor="s-wmax">Maximum wait (minutes)</label><input id="s-wmax" type="number" min="0" max="240" className={inputCls} value={form.waitMax} onChange={(e) => setForm({ ...form, waitMax: Number(e.target.value) })} /></div>
          <div><label className={labelCls} htmlFor="s-name">Restaurant name</label><input id="s-name" className={inputCls} value={form.restaurantName} onChange={(e) => setForm({ ...form, restaurantName: e.target.value })} required /></div>
          <div><label className={labelCls} htmlFor="s-phone">Phone</label><input id="s-phone" className={inputCls} value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value || null })} /></div>
          <div><label className={labelCls} htmlFor="s-email">Email</label><input id="s-email" type="email" className={inputCls} value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value || null })} /></div>
          <div><label className={labelCls} htmlFor="s-addr">Address</label><input id="s-addr" className={inputCls} value={form.address ?? ''} onChange={(e) => setForm({ ...form, address: e.target.value || null })} /></div>
          <div className="md:col-span-2"><button type="submit" disabled={busy} className={primaryBtn}>Save settings</button></div>
        </form>
      )}
    </div>
  );
}
