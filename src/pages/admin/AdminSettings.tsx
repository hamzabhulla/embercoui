import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { adminGet, adminSend } from '../../services/adminApi';
import { usePermissions } from '../../components/admin/PermissionsContext';
import { useCurrency } from '../../context/CurrencyContext';
import { CURRENCY_CODES, currencyName, formatMoney } from '../../lib/currency';
import { NOTHING_LIVE, liveLocationValues } from '../../lib/locationPreview';
import { Card, CardHead, ErrorNote, LoadingNote, NoticeNote, PageTitle, Toggle, ghostBtn, inputCls, primaryBtn } from '../../components/admin/ui';
import { MapPickerBoundary } from '../../components/admin/MapPickerBoundary';

interface SiteLocations {
  footer: { phone: string | null; email: string | null; address: string | null };
  contact: { phone: string | null; email: string | null; address: string | null; hours: string | null; mapLocation: string | null; mapLat: number | null; mapLng: number | null };
  reservation: { phone: string | null; address: string | null; hours: string | null; locationLabel: string | null };
}

const EMPTY_SITE_LOCATIONS: SiteLocations = {
  footer: { phone: null, email: null, address: null },
  contact: { phone: null, email: null, address: null, hours: null, mapLocation: null, mapLat: null, mapLng: null },
  reservation: { phone: null, address: null, hours: null, locationLabel: null },
};

interface Settings {
  kitchenOpen: boolean; waitMin: number; waitMax: number; currency: string;
  restaurantName: string; phone: string | null; email: string | null; address: string | null;
  whatsappNumber: string | null;
  reservationSlotCapacity: number;
  reservationFeeEnabled: boolean;
  reservationFeeAmount: number;
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
  const { can } = usePermissions();
  const canManage = can('settings', 'manage');
  const [form, setForm] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const { refresh } = useCurrency();
  // Whether a card provider is connected in this deployment — the
  // reservation fee can only take effect when one is (the server
  // enforces the same rule; this flag drives the honest note below).
  const [stripeConfigured, setStripeConfigured] = useState(false);
  useEffect(() => {
    adminGet<{ settings: Settings; stripeConfigured?: boolean }>('/api/v1/admin/settings')
      .then((d) => {
        setForm({ ...d.settings, siteLocations: d.settings.siteLocations ?? EMPTY_SITE_LOCATIONS });
        setStripeConfigured(d.stripeConfigured ?? false);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  const setLocation = <G extends keyof SiteLocations>(group: G, field: keyof SiteLocations[G], value: string | number | null) => {
    setForm((f) => (f ? { ...f, siteLocations: { ...f.siteLocations, [group]: { ...f.siteLocations[group], [field]: value } } } : f));
  };
  const [pickerOpen, setPickerOpen] = useState(false);
  // Leaflet (~40 kB gzip) loads only when the admin opens the pin picker —
  // never in the settings chunk's initial render, never for customers.
  // The lazy component is rebuilt per attempt: a rejected chunk import
  // stays rejected on the same lazy() object forever, so when the picker
  // boundary's retry bumps this counter the admin gets a genuinely fresh
  // import instead of the same cached failure.
  const [pickerAttempt, setPickerAttempt] = useState(0);
  const MapLocationPicker = useMemo(() => {
    // Read on purpose: the attempt value itself is the cache-buster —
    // a changed attempt must rebuild the lazy() below.
    void pickerAttempt;
    return lazy(() => import('../../components/admin/MapLocationPicker'));
  }, [pickerAttempt]);
  // A pin settle writes BOTH coordinates (the API stores the pair or
  // nothing) and, when Nominatim resolved a name, refreshes the Map
  // location text with it — the text stays the fallback if the pin is
  // ever cleared, so the two never disagree about the place.
  const handlePin = (lat: number, lng: number, resolvedAddress: string | null) => {
    setForm((f) => (f ? {
      ...f,
      siteLocations: {
        ...f.siteLocations,
        contact: {
          ...f.siteLocations.contact, mapLat: lat, mapLng: lng,
          // Code-point-safe cap: a plain slice() could cut a surrogate
          // pair in half and store a lone surrogate in the address.
          ...(resolvedAddress ? { mapLocation: Array.from(resolvedAddress).slice(0, 300).join('') } : {}),
        },
      },
    } : f));
  };
  const clearPin = () => {
    setForm((f) => (f ? {
      ...f,
      siteLocations: { ...f.siteLocations, contact: { ...f.siteLocations.contact, mapLat: null, mapLng: null } },
    } : f));
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
  // What the website shows right now for every location field, resolved
  // from the CURRENT form state (profile edits included, saved or not) —
  // used only as placeholders and the map's live line, never as values.
  const live = form
    ? liveLocationValues(
        { phone: form.phone, email: form.email, address: form.address, openingHours: form.openingHours },
        form.siteLocations,
      )
    : null;
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
      // Numbers (the map pin) pass through untouched.
      const normGroup = (g: Record<string, string | number | null>) =>
        Object.fromEntries(Object.entries(g).map(([k, v]) => [k, typeof v === 'number' ? v : (v?.trim() ? v.trim() : null)]));
      const sentLocations = {
        footer: normGroup(form.siteLocations.footer),
        contact: normGroup(form.siteLocations.contact),
        reservation: normGroup(form.siteLocations.reservation),
      } as SiteLocations;
      const sentFee = { enabled: form.reservationFeeEnabled, amount: form.reservationFeeAmount };
      const res = await adminSend<{ settings: Settings }>('PATCH', '/api/v1/admin/settings', {
        kitchenOpen: form.kitchenOpen, waitMin: form.waitMin, waitMax: form.waitMax, currency: form.currency,
        restaurantName: form.restaurantName, phone: form.phone, email: form.email, address: form.address,
        whatsappNumber: form.whatsappNumber,
        reservationSlotCapacity: form.reservationSlotCapacity,
        reservationFeeEnabled: form.reservationFeeEnabled,
        reservationFeeAmount: form.reservationFeeAmount,
        openingHours: form.openingHours,
        siteLocations: sentLocations,
      });
      const saved: Settings = { ...res.settings, siteLocations: res.settings.siteLocations ?? EMPTY_SITE_LOCATIONS };
      setForm(saved);
      // Same honesty check for the fee fields (migration 0014): until
      // it runs, the API accepts the save but cannot persist them — a
      // fee value that was sent and came back different never reached
      // the database, and the admin deserves to be told exactly that.
      const feeNotPersisted = saved.reservationFeeEnabled !== sentFee.enabled
        || Number(saved.reservationFeeAmount) !== Number(sentFee.amount);
      // Honesty check: until migration 0010 runs, the API accepts the
      // save but cannot persist site_locations — a location value that
      // was sent non-empty and came back null never reached the
      // database, and the admin deserves to be told exactly that.
      const lostLocationValue = (['footer', 'contact', 'reservation'] as const).some((g) => {
        const sent = sentLocations[g] as Record<string, string | number | null>;
        const back = saved.siteLocations[g] as Record<string, string | number | null>;
        return Object.keys(sent).some((k) => sent[k] != null && sent[k] !== '' && back[k] == null);
      });
      setNotice(lostLocationValue
        ? 'Settings saved. Note: location-specific fields activate after the site-locations database update (migration 0010) is run.'
        : feeNotPersisted
          ? 'Settings saved. Note: the reservation fee fields activate after the database update (migration 0014) is run.'
          : 'Settings saved.');
      void refresh();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div>
      <PageTitle sub="The kitchen toggle and wait times drive the live status on the website">Settings</PageTitle>
      {error && <ErrorNote message={error} />}
      {notice && <NoticeNote message={notice} />}
      {form && !canManage && <NoticeNote message="You have view-only access to settings — changes are disabled." />}
      {!form && !error && <LoadingNote />}
      {form && (
        <form onSubmit={save} className="max-w-3xl">
          {/* A disabled fieldset makes every control inside inert at
              once for view-only holders (the backend refuses the save
              too) — including the toggles and the map picker buttons. */}
          <fieldset disabled={!canManage} className="space-y-5 min-w-0">
          <Card>
            <CardHead title="Kitchen & ordering" />
            <div className="divide-y divide-[#EFE9DB]">
              <div className="flex flex-wrap items-center justify-between gap-4 px-[18px] py-3.5">
                <div className="min-w-[220px] flex-1">
                  <b className="font-bodytext text-[13.5px] font-semibold text-[#16241A] block">Kitchen is open</b>
                  <span className="font-bodytext text-[12px] text-[#98A096]">Shown live on the website — turning this off stops ordering</span>
                </div>
                <span className="flex items-center gap-2.5">
                  <span className={`font-bodytext text-[12.5px] font-semibold ${form.kitchenOpen ? 'text-[#2E7D4F]' : 'text-[#B0492F]'}`}>{form.kitchenOpen ? 'OPEN' : 'CLOSED'}</span>
                  <Toggle on={form.kitchenOpen} onClick={() => setForm({ ...form, kitchenOpen: !form.kitchenOpen })} label="Kitchen is open" />
                </span>
              </div>
              <SetRow title="Minimum wait (minutes)" desc="This is the range the live status strip on the homepage shows">
                <input id="s-wmin" type="number" min="0" max="240" className={inputCls} value={form.waitMin} onChange={(e) => setForm({ ...form, waitMin: Number(e.target.value) })} />
              </SetRow>
              <SetRow title="Maximum wait (minutes)" desc="The wait should not go above this, even in busy hours">
                <input id="s-wmax" type="number" min="0" max="240" className={inputCls} value={form.waitMax} onChange={(e) => setForm({ ...form, waitMax: Number(e.target.value) })} />
              </SetRow>
              <SetRow title="Reservation capacity per time slot (guests)" desc="The day board on the Reservations page counts each time slot's booked and remaining guests against this capacity">
                <input id="s-rescap" type="number" min="1" max="500" className={inputCls} value={form.reservationSlotCapacity} onChange={(e) => setForm({ ...form, reservationSlotCapacity: Number(e.target.value) })} />
              </SetRow>
            </div>
          </Card>
          <Card>
            <CardHead title="Reservation fee" />
            <div className="divide-y divide-[#EFE9DB]">
              <div className="flex flex-wrap items-center justify-between gap-4 px-[18px] py-3.5">
                <div className="min-w-[220px] flex-1">
                  <b className="font-bodytext text-[13.5px] font-semibold text-[#16241A] block">Charge a booking fee</b>
                  <span className="font-bodytext text-[12px] text-[#98A096]">A flat fee per reservation, charged online by card when a guest books on the website. Reservations added by staff are never charged</span>
                </div>
                <span className="flex items-center gap-2.5">
                  <span className={`font-bodytext text-[12.5px] font-semibold ${form.reservationFeeEnabled ? 'text-[#2E7D4F]' : 'text-[#B0492F]'}`}>{form.reservationFeeEnabled ? 'ON' : 'OFF'}</span>
                  <Toggle on={form.reservationFeeEnabled} onClick={() => setForm({ ...form, reservationFeeEnabled: !form.reservationFeeEnabled })} label="Charge a booking fee" />
                </span>
              </div>
              <SetRow title="Fee amount" desc={`Per reservation, in the restaurant currency (${form.currency}) — the fee only applies with an amount above zero`}>
                <input id="s-resfee" type="number" min="0" max="10000" step="any" className={inputCls} value={form.reservationFeeAmount} onChange={(e) => setForm({ ...form, reservationFeeAmount: Number(e.target.value) })} />
              </SetRow>
              {form.reservationFeeEnabled && !stripeConfigured && (
                <p className="px-[18px] py-3.5 font-bodytext text-[12.5px] font-semibold text-[#B07C1E]">
                  Card payments are not connected on this deployment yet, so this fee cannot be charged — bookings stay free until a card provider is connected.
                </p>
              )}
              {form.reservationFeeEnabled && stripeConfigured && form.reservationFeeAmount <= 0 && (
                <p className="px-[18px] py-3.5 font-bodytext text-[12.5px] font-semibold text-[#B07C1E]">
                  The fee is switched on but the amount is zero — bookings stay free until an amount above zero is set.
                </p>
              )}
              {form.reservationFeeEnabled && stripeConfigured && form.reservationFeeAmount > 0 && (
                <p className="px-[18px] py-3.5 font-bodytext text-[12.5px] text-[#5C665C]">
                  Guests are charged {formatMoney(form.reservationFeeAmount, form.currency)} by card when they book, and the table is held once the fee is paid.
                </p>
              )}
            </div>
          </Card>
          <Card>
            <CardHead title="Currency" />
            <div className="divide-y divide-[#EFE9DB]">
              <SetRow title="Restaurant currency" desc="Menu prices, orders and card payments are all in this currency. Changing the currency does NOT convert existing prices automatically — enter the prices again to match the new currency.">
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
              <SetRow title="Restaurant name" desc="This name appears on the site, in emails and on receipts">
                <input id="s-name" className={inputCls} value={form.restaurantName} onChange={(e) => setForm({ ...form, restaurantName: e.target.value })} required />
              </SetRow>
              <SetRow title="Phone" desc="Shown on the Contact page and in order confirmations">
                <input id="s-phone" className={inputCls} value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value || null })} />
              </SetRow>
              <SetRow title="Email" desc="Customer replies arrive at this address">
                <input id="s-email" type="email" className={inputCls} value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value || null })} />
              </SetRow>
              <SetRow title="Address" desc="Used on the Contact page and for delivery">
                <input id="s-addr" className={inputCls} value={form.address ?? ''} onChange={(e) => setForm({ ...form, address: e.target.value || null })} />
              </SetRow>
              <SetRow title="WhatsApp number" desc="The floating WhatsApp button on the site opens this number — leave it empty and the button will not appear. Include the country code">
                <input id="s-whatsapp" className={inputCls} placeholder="+92 300 1234567" value={form.whatsappNumber ?? ''} onChange={(e) => setForm({ ...form, whatsappNumber: e.target.value || null })} />
              </SetRow>
            </div>
          </Card>
          <Card>
            <CardHead title="Website locations" />
            <div className="divide-y divide-[#EFE9DB]">
              <GroupHead title="Footer" hint="Leave empty to use the Restaurant profile value." />
              <SetRow title="Footer phone" desc="Shown in the footer at the bottom of every page">
                <input id="s-footer-phone" className={inputCls} placeholder={live?.footer.phone} value={form.siteLocations.footer.phone ?? ''} onChange={(e) => setLocation('footer', 'phone', e.target.value || null)} />
              </SetRow>
              <SetRow title="Footer email" desc="Shown in the footer's Visit Us section">
                <input id="s-footer-email" type="email" className={inputCls} placeholder={live?.footer.email} value={form.siteLocations.footer.email ?? ''} onChange={(e) => setLocation('footer', 'email', e.target.value || null)} />
              </SetRow>
              <SetRow title="Footer address" desc="Shown in the footer's Visit Us section — press Enter for a new line">
                <textarea id="s-footer-addr" className={inputCls} rows={2} placeholder={live?.footer.address} value={form.siteLocations.footer.address ?? ''} onChange={(e) => setLocation('footer', 'address', e.target.value || null)} />
              </SetRow>
              <GroupHead title="Contact page" hint="Leave empty to use the Restaurant profile value." />
              <SetRow title="Contact phone" desc="Shown in the Phone card on the Contact page">
                <input id="s-contact-phone" className={inputCls} placeholder={live?.contact.phone} value={form.siteLocations.contact.phone ?? ''} onChange={(e) => setLocation('contact', 'phone', e.target.value || null)} />
              </SetRow>
              <SetRow title="Contact email" desc="Shown in the Email card on the Contact page">
                <input id="s-contact-email" type="email" className={inputCls} placeholder={live?.contact.email} value={form.siteLocations.contact.email ?? ''} onChange={(e) => setLocation('contact', 'email', e.target.value || null)} />
              </SetRow>
              <SetRow title="Contact address" desc="Shown in the Location card on the Contact page, below the map — press Enter for a new line">
                <textarea id="s-contact-addr" className={inputCls} rows={2} placeholder={live?.contact.address} value={form.siteLocations.contact.address ?? ''} onChange={(e) => setLocation('contact', 'address', e.target.value || null)} />
              </SetRow>
              <SetRow title="Opening hours text" desc="Shown in the Hours card on the Contact page — press Enter for a new line">
                <textarea id="s-contact-hours" className={inputCls} rows={2} placeholder={live?.contact.hours} value={form.siteLocations.contact.hours ?? ''} onChange={(e) => setLocation('contact', 'hours', e.target.value || null)} />
              </SetRow>
              <SetRow title="Map location" desc="The map and the directions link point to this place — this text is used when no pin is set below; when a pin is set, the pin wins">
                <input id="s-contact-map" className={inputCls} placeholder={live?.contact.mapTextFallback} value={form.siteLocations.contact.mapLocation ?? ''} onChange={(e) => setLocation('contact', 'mapLocation', e.target.value || null)} />
              </SetRow>
              <div className="px-[18px] py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-[220px] flex-1">
                    <b className="font-bodytext text-[13.5px] font-semibold text-[#16241A] block">Map pin</b>
                    <span className="font-bodytext text-[12px] text-[#98A096]">
                      {form.siteLocations.contact.mapLat !== null && form.siteLocations.contact.mapLng !== null
                        ? 'Pin is set — the Contact page map shows exactly this point'
                        : 'No pin set — the map uses the Map location text above'}
                    </span>
                    {form.siteLocations.contact.mapLat !== null && form.siteLocations.contact.mapLng !== null && (
                      <span className="block pt-1 font-mono text-[11.5px] text-[#98A096]">
                        {form.siteLocations.contact.mapLat.toFixed(6)}, {form.siteLocations.contact.mapLng.toFixed(6)}
                      </span>
                    )}
                    {(form.siteLocations.contact.mapLat === null || form.siteLocations.contact.mapLng === null) && live && (
                      <span className="block pt-1 font-bodytext text-[12px] text-[#98A096]">
                        Live on the website right now: <span className="text-[#5C665C]">{live.contact.mapTarget ?? NOTHING_LIVE}</span>
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {form.siteLocations.contact.mapLat !== null && !pickerOpen && (
                      <button type="button" className={ghostBtn} onClick={clearPin}>Clear pin</button>
                    )}
                    <button type="button" className={ghostBtn} onClick={() => setPickerOpen((o) => !o)}>
                      {pickerOpen ? 'Close map' : form.siteLocations.contact.mapLat !== null ? 'Adjust on map' : 'Choose on map'}
                    </button>
                  </div>
                </div>
                {pickerOpen && (
                  <div className="pt-3">
                    <MapPickerBoundary onRetry={() => setPickerAttempt((n) => n + 1)}>
                      <Suspense fallback={<p className="font-bodytext text-[12.5px] text-[#98A096]">Loading map…</p>}>
                        <MapLocationPicker
                          lat={form.siteLocations.contact.mapLat}
                          lng={form.siteLocations.contact.mapLng}
                          fallbackText={form.siteLocations.contact.mapLocation ?? form.siteLocations.contact.address ?? form.address}
                          onPin={handlePin}
                          onClear={clearPin}
                        />
                      </Suspense>
                    </MapPickerBoundary>
                  </div>
                )}
              </div>
              <GroupHead title="Reservation section" hint="Leave empty to use the Restaurant profile value." />
              <SetRow title="Reservation phone" desc="Shown in the info lines of the reservation section on the homepage">
                <input id="s-res-phone" className={inputCls} placeholder={live?.reservation.phone} value={form.siteLocations.reservation.phone ?? ''} onChange={(e) => setLocation('reservation', 'phone', e.target.value || null)} />
              </SetRow>
              <SetRow title="Reservation address" desc="The first info line in the reservation section — press Enter for a new line">
                <textarea id="s-res-addr" className={inputCls} rows={2} placeholder={live?.reservation.address} value={form.siteLocations.reservation.address ?? ''} onChange={(e) => setLocation('reservation', 'address', e.target.value || null)} />
              </SetRow>
              <SetRow title="Hours text" desc="The opening-hours line in the reservation section">
                <input id="s-res-hours" className={inputCls} placeholder={live?.reservation.hours} value={form.siteLocations.reservation.hours ?? ''} onChange={(e) => setLocation('reservation', 'hours', e.target.value || null)} />
              </SetRow>
              <SetRow title="Location label" desc="The small line under Book Your Table">
                <input id="s-res-label" className={inputCls} placeholder={live?.reservation.locationLabel} value={form.siteLocations.reservation.locationLabel ?? ''} onChange={(e) => setLocation('reservation', 'locationLabel', e.target.value || null)} />
              </SetRow>
              <GroupHead title="Opening hours" hint="Used by the AI assistant and as a fallback wherever hours are shown." />
              <SetRow title="Weekday hours" desc="Example: 11:00 AM – 11:00 PM">
                <input id="s-hours-weekdays" className={inputCls} value={hoursValue('weekdays')} onChange={(e) => setOpeningHour('weekdays', e.target.value)} />
              </SetRow>
              <SetRow title="Weekend hours" desc="Example: 10:00 AM – 12:00 AM">
                <input id="s-hours-weekends" className={inputCls} value={hoursValue('weekends')} onChange={(e) => setOpeningHour('weekends', e.target.value)} />
              </SetRow>
            </div>
          </Card>
          {canManage && <div><button type="submit" disabled={busy} className={primaryBtn}>Save settings</button></div>}
          </fieldset>
        </form>
      )}
    </div>
  );
}
