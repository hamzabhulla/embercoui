import React, { useEffect, useState } from 'react';
import { adminGet, adminSend } from '../../services/adminApi';
import { useCurrency } from '../../context/CurrencyContext';
import { CURRENCY_CODES, currencyName } from '../../lib/currency';
import { Card, CardHead, ErrorNote, LoadingNote, NoticeNote, PageTitle, Toggle, inputCls, primaryBtn } from '../../components/admin/ui';

interface Settings {
  kitchenOpen: boolean; waitMin: number; waitMax: number; currency: string;
  restaurantName: string; phone: string | null; email: string | null; address: string | null;
  whatsappNumber: string | null;
  openingHours: Record<string, unknown>;
}

const PINNED = ['USD', 'PKR'];
const CURRENCY_OPTIONS = [...PINNED, ...CURRENCY_CODES.filter((c) => !PINNED.includes(c))];

function SetRow({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 px-[18px] py-3.5">
      <div className="min-w-[220px] flex-1">
        <b className="font-bodytext text-[13.5px] font-semibold text-[#16241A] block">{title}</b>
        <span className="font-bodytext text-[12px] text-[#98A096]">{desc}</span>
      </div>
      <div className="w-full sm:w-[300px] shrink-0">{children}</div>
    </div>
  );
}

export default function AdminSettings() {
  const [form, setForm] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const { refresh } = useCurrency();
  useEffect(() => {
    adminGet<{ settings: Settings }>('/api/v1/admin/settings').then((d) => setForm(d.settings)).catch((e: Error) => setError(e.message));
  }, []);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const res = await adminSend<{ settings: Settings }>('PATCH', '/api/v1/admin/settings', {
        kitchenOpen: form.kitchenOpen, waitMin: form.waitMin, waitMax: form.waitMax, currency: form.currency,
        restaurantName: form.restaurantName, phone: form.phone, email: form.email, address: form.address,
        whatsappNumber: form.whatsappNumber,
        openingHours: form.openingHours,
      });
      setForm(res.settings);
      setNotice('Settings saved — the website header updates right away.');
      void refresh();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div>
      <PageTitle sub="The kitchen toggle and wait times drive the live status on the website">Settings</PageTitle>
      {error && <ErrorNote message={error} />}
      {notice && <NoticeNote message={notice} />}
      {!form && !error && <LoadingNote />}
      {form && (
        <form onSubmit={save} className="space-y-5 max-w-3xl">
          <Card>
            <CardHead title="Kitchen & ordering" />
            <div className="divide-y divide-[#EFE9DB]">
              <div className="flex flex-wrap items-center justify-between gap-4 px-[18px] py-3.5">
                <div className="min-w-[220px] flex-1">
                  <b className="font-bodytext text-[13.5px] font-semibold text-[#16241A] block">Kitchen is open</b>
                  <span className="font-bodytext text-[12px] text-[#98A096]">Shown live on the website — band karne se ordering ruk jati hai</span>
                </div>
                <span className="flex items-center gap-2.5">
                  <span className={`font-bodytext text-[12.5px] font-semibold ${form.kitchenOpen ? 'text-[#2E7D4F]' : 'text-[#B0492F]'}`}>{form.kitchenOpen ? 'OPEN' : 'CLOSED'}</span>
                  <Toggle on={form.kitchenOpen} onClick={() => setForm({ ...form, kitchenOpen: !form.kitchenOpen })} label="Kitchen is open" />
                </span>
              </div>
              <SetRow title="Minimum wait (minutes)" desc="Homepage ki live status patti par yehi range dikhta hai">
                <input id="s-wmin" type="number" min="0" max="240" className={inputCls} value={form.waitMin} onChange={(e) => setForm({ ...form, waitMin: Number(e.target.value) })} />
              </SetRow>
              <SetRow title="Maximum wait (minutes)" desc="Busy hours mein is se zyada nahi jana chahiye">
                <input id="s-wmax" type="number" min="0" max="240" className={inputCls} value={form.waitMax} onChange={(e) => setForm({ ...form, waitMax: Number(e.target.value) })} />
              </SetRow>
            </div>
          </Card>
          <Card>
            <CardHead title="Currency" />
            <div className="divide-y divide-[#EFE9DB]">
              <SetRow title="Restaurant currency" desc="Menu prices, orders aur card payments isi currency mein honge. Currency badalne se purani prices khud convert NAHI hoti — prices nayi currency ke hisaab se dobara likhein.">
                <select id="s-currency" aria-label="Restaurant currency" className={inputCls} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                  {CURRENCY_OPTIONS.map((c) => (
                    <option key={c} value={c}>{c} — {currencyName(c)}</option>
                  ))}
                </select>
              </SetRow>
            </div>
          </Card>
          <Card>
            <CardHead title="Restaurant profile" />
            <div className="divide-y divide-[#EFE9DB]">
              <SetRow title="Restaurant name" desc="Site, emails aur receipts par yehi naam ata hai">
                <input id="s-name" className={inputCls} value={form.restaurantName} onChange={(e) => setForm({ ...form, restaurantName: e.target.value })} required />
              </SetRow>
              <SetRow title="Phone" desc="Contact page aur order confirmations par">
                <input id="s-phone" className={inputCls} value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value || null })} />
              </SetRow>
              <SetRow title="Email" desc="Customers ke jawabat yahin ate hain">
                <input id="s-email" type="email" className={inputCls} value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value || null })} />
              </SetRow>
              <SetRow title="Address" desc="Contact page aur delivery ke liye">
                <input id="s-addr" className={inputCls} value={form.address ?? ''} onChange={(e) => setForm({ ...form, address: e.target.value || null })} />
              </SetRow>
              <SetRow title="WhatsApp number" desc="Site par tairne wala WhatsApp button isi number par khulta hai — khaali chhoro ge to button nahi dikhega. Country code ke saath likho">
                <input id="s-whatsapp" className={inputCls} placeholder="+92 300 1234567" value={form.whatsappNumber ?? ''} onChange={(e) => setForm({ ...form, whatsappNumber: e.target.value || null })} />
              </SetRow>
            </div>
          </Card>
          <div><button type="submit" disabled={busy} className={primaryBtn}>Save settings</button></div>
        </form>
      )}
    </div>
  );
}
