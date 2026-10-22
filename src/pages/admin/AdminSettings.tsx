import React, { useEffect, useState } from 'react';
import { adminGet, adminSend } from '../../services/adminApi';
import { useAuth } from '../../context/AuthContext';
import { useCurrency } from '../../context/CurrencyContext';
import { CURRENCY_CODES, currencyName } from '../../lib/currency';
import { AdminsOnly, Card, CardHead, ErrorNote, LoadingNote, NoticeNote, PageTitle, Toggle, inputCls, primaryBtn } from '../../components/admin/ui';

interface SiteLocations {
  footer: { phone: string | null; email: string | null; address: string | null };
  contact: { phone: string | null; email: string | null; address: string | null; hours: string | null; mapLocation: string | null };
  reservation: { phone: string | null; address: string | null; hours: string | null; locationLabel: string | null };
}

const EMPTY_SITE_LOCATIONS: SiteLocations = {
  footer: { phone: null, email: null, address: null },
  contact: { phone: null, email: null, address: null, hours: null, mapLocation: null },
  reservation: { phone: null, address: null, hours: null, locationLabel: null },
};

interface Settings {
  kitchenOpen: boolean; waitMin: number; waitMax: number; currency: string;
  restaurantName: string; phone: string | null; email: string | null; address: string | null;
  whatsappNumber: string | null;
  reservationSlotCapacity: number;
  openingHours: Record<string, unknown>;
  siteLocations: SiteLocations;
}

const PINNED = ['USD', 'PKR'];
const CURRENCY_OPTIONS = [...PINNED, ...CURRENCY_CODES.filter((c) => !PINNED.includes(c))];

function GroupHead({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="px-[18px] pt-4 pb-1">
      <b className="font-bodytext text-[13px] font-semibold text-[#16241A] block">{title}</b>
      <span className="font-bodytext text-[12px] text-[#98A096]">{hint}</span>
    </div>
  );
}

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
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [form, setForm] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const { refresh } = useCurrency();
  useEffect(() => {
    if (!isAdmin) return;
    adminGet<{ settings: Settings }>('/api/v1/admin/settings')
      .then((d) => setForm({ ...d.settings, siteLocations: d.settings.siteLocations ?? EMPTY_SITE_LOCATIONS }))
      .catch((e: Error) => setError(e.message));
  }, [isAdmin]);
  const setLocation = <G extends keyof SiteLocations>(group: G, field: keyof SiteLocations[G], value: string | null) => {
    setForm((f) => (f ? { ...f, siteLocations: { ...f.siteLocations, [group]: { ...f.siteLocations[group], [field]: value } } } : f));
  };
  const setOpeningHour = (key: 'weekdays' | 'weekends', value: string) => {
    setForm((f) => {
      if (!f) return f;
      const openingHours = { ...f.openingHours };
      if (value) openingHours[key] = value;
      else delete openingHours[key];
      return { ...f, openingHours };
    });
  };
  const hoursValue = (key: 'weekdays' | 'weekends'): string => {
    const v = form?.openingHours[key];
    return typeof v === 'string' ? v : '';
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    // The same wait-range rule the API enforces on the merged settings —
    // caught here so the admin sees the error without a round trip.
    if (form.waitMax < form.waitMin) { setError('Maximum wait must be at least the minimum wait'); setNotice(''); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      // Normalize like the server does (trim; whitespace-only → null) so
      // the sent-vs-returned honesty check below compares real values.
      const normGroup = (g: Record<string, string | null>) =>
        Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v?.trim() ? v.trim() : null]));
      const sentLocations = {
        footer: normGroup(form.siteLocations.footer),
        contact: normGroup(form.siteLocations.contact),
        reservation: normGroup(form.siteLocations.reservation),
      } as SiteLocations;
      const res = await adminSend<{ settings: Settings }>('PATCH', '/api/v1/admin/settings', {
        kitchenOpen: form.kitchenOpen, waitMin: form.waitMin, waitMax: form.waitMax, currency: form.currency,
        restaurantName: form.restaurantName, phone: form.phone, email: form.email, address: form.address,
        whatsappNumber: form.whatsappNumber,
        reservationSlotCapacity: form.reservationSlotCapacity,
        openingHours: form.openingHours,
        siteLocations: sentLocations,
      });
      const saved: Settings = { ...res.settings, siteLocations: res.settings.siteLocations ?? EMPTY_SITE_LOCATIONS };
      setForm(saved);
      // Honesty check: until migration 0010 runs, the API accepts the
      // save but cannot persist site_locations — a location value that
      // was sent non-empty and came back null never reached the
      // database, and the admin deserves to be told exactly that.
      const lostLocationValue = (['footer', 'contact', 'reservation'] as const).some((g) => {
        const sent = sentLocations[g] as Record<string, string | null>;
        const back = saved.siteLocations[g] as Record<string, string | null>;
        return Object.keys(sent).some((k) => sent[k] != null && sent[k] !== '' && back[k] == null);
      });
      setNotice(lostLocationValue
        ? 'Settings saved. Note: location-specific fields activate after the site-locations database update (migration 0010) is run.'
        : 'Settings saved.');
      void refresh();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  if (!isAdmin) return <AdminsOnly />;
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
              <SetRow title="Reservation capacity per time slot (guests)" desc="Reservations page ka day board isi capacity se har time slot ke booked / remaining guests gin-ta hai">
                <input id="s-rescap" type="number" min="1" max="500" className={inputCls} value={form.reservationSlotCapacity} onChange={(e) => setForm({ ...form, reservationSlotCapacity: Number(e.target.value) })} />
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
          <Card>
            <CardHead title="Website locations" />
            <div className="divide-y divide-[#EFE9DB]">
              <GroupHead title="Footer" hint="Leave empty to use the Restaurant profile value." />
              <SetRow title="Footer phone" desc="Har page ke neechay footer mein">
                <input id="s-footer-phone" className={inputCls} value={form.siteLocations.footer.phone ?? ''} onChange={(e) => setLocation('footer', 'phone', e.target.value || null)} />
              </SetRow>
              <SetRow title="Footer email" desc="Footer ke Visit Us hissay mein">
                <input id="s-footer-email" type="email" className={inputCls} value={form.siteLocations.footer.email ?? ''} onChange={(e) => setLocation('footer', 'email', e.target.value || null)} />
              </SetRow>
              <SetRow title="Footer address" desc="Footer ke Visit Us hissay mein — nayi line ke liye Enter dabao">
                <textarea id="s-footer-addr" className={inputCls} rows={2} value={form.siteLocations.footer.address ?? ''} onChange={(e) => setLocation('footer', 'address', e.target.value || null)} />
              </SetRow>
              <GroupHead title="Contact page" hint="Leave empty to use the Restaurant profile value." />
              <SetRow title="Contact phone" desc="Contact page ke Phone card mein">
                <input id="s-contact-phone" className={inputCls} value={form.siteLocations.contact.phone ?? ''} onChange={(e) => setLocation('contact', 'phone', e.target.value || null)} />
              </SetRow>
              <SetRow title="Contact email" desc="Contact page ke Email card mein">
                <input id="s-contact-email" type="email" className={inputCls} value={form.siteLocations.contact.email ?? ''} onChange={(e) => setLocation('contact', 'email', e.target.value || null)} />
              </SetRow>
              <SetRow title="Contact address" desc="Contact page ke Location card aur map ke neechay — nayi line ke liye Enter dabao">
                <textarea id="s-contact-addr" className={inputCls} rows={2} value={form.siteLocations.contact.address ?? ''} onChange={(e) => setLocation('contact', 'address', e.target.value || null)} />
              </SetRow>
              <SetRow title="Opening hours text" desc="Contact page ke Hours card mein — nayi line ke liye Enter dabao">
                <textarea id="s-contact-hours" className={inputCls} rows={2} value={form.siteLocations.contact.hours ?? ''} onChange={(e) => setLocation('contact', 'hours', e.target.value || null)} />
              </SetRow>
              <SetRow title="Map location" desc="Map aur directions link isi jagah ko dikhata hai">
                <input id="s-contact-map" className={inputCls} value={form.siteLocations.contact.mapLocation ?? ''} onChange={(e) => setLocation('contact', 'mapLocation', e.target.value || null)} />
              </SetRow>
              <GroupHead title="Reservation section" hint="Leave empty to use the Restaurant profile value." />
              <SetRow title="Reservation phone" desc="Homepage ke reservation hissay ki info lines mein">
                <input id="s-res-phone" className={inputCls} value={form.siteLocations.reservation.phone ?? ''} onChange={(e) => setLocation('reservation', 'phone', e.target.value || null)} />
              </SetRow>
              <SetRow title="Reservation address" desc="Reservation hissay ki pehli info line — nayi line ke liye Enter dabao">
                <textarea id="s-res-addr" className={inputCls} rows={2} value={form.siteLocations.reservation.address ?? ''} onChange={(e) => setLocation('reservation', 'address', e.target.value || null)} />
              </SetRow>
              <SetRow title="Hours text" desc="Reservation hissay ki ghanton wali line">
                <input id="s-res-hours" className={inputCls} value={form.siteLocations.reservation.hours ?? ''} onChange={(e) => setLocation('reservation', 'hours', e.target.value || null)} />
              </SetRow>
              <SetRow title="Location label" desc="Book Your Table ke neechay chhoti si line">
                <input id="s-res-label" className={inputCls} value={form.siteLocations.reservation.locationLabel ?? ''} onChange={(e) => setLocation('reservation', 'locationLabel', e.target.value || null)} />
              </SetRow>
              <GroupHead title="Opening hours" hint="Used by the AI assistant and as a fallback wherever hours are shown." />
              <SetRow title="Weekday hours" desc="Misal: 11:00 AM – 11:00 PM">
                <input id="s-hours-weekdays" className={inputCls} value={hoursValue('weekdays')} onChange={(e) => setOpeningHour('weekdays', e.target.value)} />
              </SetRow>
              <SetRow title="Weekend hours" desc="Misal: 10:00 AM – 12:00 AM">
                <input id="s-hours-weekends" className={inputCls} value={hoursValue('weekends')} onChange={(e) => setOpeningHour('weekends', e.target.value)} />
              </SetRow>
            </div>
          </Card>
          <div><button type="submit" disabled={busy} className={primaryBtn}>Save settings</button></div>
        </form>
      )}
    </div>
  );
}
