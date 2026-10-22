import React, { useEffect, useMemo, useRef, useState } from 'react';
import { adminGet, adminSend } from '../../services/adminApi';
import { useAuth } from '../../context/AuthContext';
import { useCurrency } from '../../context/CurrencyContext';
import { Card, EmptyNote, ErrorNote, FChip, LoadingNote, NoticeNote, PageTitle, SearchInput, Toggle, chipDangerBtn, chipGhostBtn, ghostBtn, inputCls, labelCls, money, primaryBtn, tableCls, tdCls, thCls } from '../../components/admin/ui';

interface Item { id: number; name: string; description: string; price: number; image: string; category: string; tags: string[]; isAvailable: boolean; sortOrder: number }
const EMPTY: Omit<Item, 'id'> = { name: '', description: '', price: 0, image: '', category: '', tags: [], isAvailable: true, sortOrder: 0 };

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(blob);
  });
}

interface PreparedImage { dataBase64: string; contentType: string; filename: string }

// Three layered caps keep uploads clear of the serverless platform's
// 4.5 MB request-body cap: this client caps the base64 payload at 4.2M
// chars (~4.2 MB JSON body), the API's own parser limit is 4.4 MB (an
// oversized body gets the API's clear 413, not the platform's opaque
// one), and only then comes the platform cap. Base64 inflates data by
// ~1.37x, so a file of ~3 MB or less (4.0 MB encoded) always fits and is
// sent UNTOUCHED — PNG transparency and GIF animation survive. Larger
// files (typical phone photos) are downscaled/re-encoded as JPEG in the
// browser, retrying smaller until the encoded result provably fits; if
// nothing fits, the admin gets a clear error instead of a silent 413.
const SAFE_UPLOAD_BYTES = 3_000_000;
const MAX_ENCODED_CHARS = 4_200_000;

async function encodeScaledJpeg(file: File, maxDim: number, quality: number): Promise<PreparedImage | null> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) return null;
  return {
    dataBase64: await blobToBase64(blob),
    contentType: 'image/jpeg',
    filename: file.name.replace(/\.[^.]+$/, '') + '.jpg',
  };
}

// Formats the upload picker accepts — only these may skip re-encoding.
const PASSTHROUGH_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

async function prepareImageUpload(file: File): Promise<PreparedImage> {
  // Untouched ONLY when the file is already in an accepted format AND
  // small enough that its base64 form provably fits the caps above. The
  // old condition (!image/ || small) let ANY non-image file — and any
  // oversized non-image — through untouched, bypassing every cap
  // (audit fix 15).
  if (PASSTHROUGH_TYPES.includes(file.type) && file.size <= SAFE_UPLOAD_BYTES) {
    return { dataBase64: await blobToBase64(file), contentType: file.type, filename: file.name };
  }
  const attempts: Array<[number, number]> = [[1600, 0.82], [1280, 0.7], [1024, 0.6]];
  for (const [dim, quality] of attempts) {
    try {
      const prepared = await encodeScaledJpeg(file, dim, quality);
      if (prepared && prepared.dataBase64.length <= MAX_ENCODED_CHARS) return prepared;
    } catch {
      // Try the next, smaller attempt.
    }
  }
  throw new Error('Image is too large even after resizing — please choose a smaller image.');
}

export default function AdminMenu() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [items, setItems] = useState<Item[]>([]);
  const [form, setForm] = useState<Omit<Item, 'id'> & { id?: number }>(EMPTY);
  const [tagsText, setTagsText] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const { currency } = useCurrency();
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [catFilter, setCatFilter] = useState('All');

  const load = () => {
    adminGet<{ items: Item[] }>('/api/v1/admin/menu').then((d) => setItems(d.items)).catch((e: Error) => setError(e.message)).finally(() => setLoaded(true));
  };
  useEffect(load, []);

  const upload = async (file: File) => {
    setBusy(true); setError('');
    try {
      const prepared = await prepareImageUpload(file);
      const res = await adminSend<{ url: string }>('POST', '/api/v1/admin/menu/upload', { filename: prepared.filename, contentType: prepared.contentType, dataBase64: prepared.dataBase64 });
      setForm((f) => ({ ...f, image: res.url }));
      setNotice('Image uploaded.');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(''); setNotice('');
    const payload = { ...form, tags: tagsText.split(',').map((t) => t.trim()).filter(Boolean) };
    try {
      if (form.id) await adminSend('PATCH', `/api/v1/admin/menu/${form.id}`, payload);
      else await adminSend('POST', '/api/v1/admin/menu', payload);
      setForm(EMPTY); setTagsText(''); setNotice('Menu item saved.'); load();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  const remove = async (id: number) => {
    setBusy(true); setError('');
    try { await adminSend('DELETE', `/api/v1/admin/menu/${id}`); load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const toggleAvailable = async (item: Item) => {
    try { await adminSend('PATCH', `/api/v1/admin/menu/${item.id}`, { isAvailable: !item.isAvailable }); load(); }
    catch (e) { setError((e as Error).message); }
  };

  const categories = useMemo(() => [...new Set(items.map((i) => i.category))], [items]);
  const filtered = items.filter((i) =>
    (catFilter === 'All' || i.category === catFilter) &&
    i.name.toLowerCase().includes(query.trim().toLowerCase()));
  const scrollToForm = () => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const startAdd = () => { setForm(EMPTY); setTagsText(''); scrollToForm(); };

  return (
    <div>
      <PageTitle sub="Changes appear on the public menu immediately" actions={<>
        <SearchInput value={query} onChange={setQuery} placeholder="Search dishes…" />
        <button className={primaryBtn} onClick={startAdd}>+ Add dish</button>
      </>}>Menu</PageTitle>
      {error && <ErrorNote message={error} />}
      {notice && <NoticeNote message={notice} />}
      <div className="flex flex-wrap gap-2 mb-5">
        <FChip active={catFilter === 'All'} onClick={() => setCatFilter('All')}>All · {items.length}</FChip>
        {categories.map((c) => (
          <FChip key={c} active={catFilter === c} onClick={() => setCatFilter(c)}>{c} · {items.filter((i) => i.category === c).length}</FChip>
        ))}
      </div>
      <Card className="mb-8 overflow-hidden">
        {!loaded && <LoadingNote />}
        {loaded && filtered.length === 0 && <EmptyNote message={items.length === 0 ? 'No dishes yet — add your first dish below.' : 'No dishes match this filter.'} />}
        {filtered.length > 0 && (
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead>
                <tr><th className={thCls}>Dish</th><th className={thCls}>Category</th><th className={thCls}>Tags</th><th className={thCls}>Price</th><th className={thCls}>Available</th><th className={thCls}></th></tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id} className="hover:bg-[#FDFBF7]">
                    <td className={tdCls}>
                      <span className="flex items-center gap-3 min-w-0">
                        {item.image && <img src={item.image} alt="" className="w-11 h-11 rounded-[9px] object-cover shrink-0" />}
                        <span className="min-w-0"><b className="font-semibold block truncate max-w-[260px]">{item.name}</b><span className="block text-[12px] text-[#98A096] truncate max-w-[260px]">{item.description}</span></span>
                      </span>
                    </td>
                    <td className={`${tdCls} text-[#5C665C]`}>{item.category}</td>
                    <td className={tdCls}>
                      {item.tags.length ? <span className="flex gap-1 flex-wrap">{item.tags.map((t) => <span key={t} className="px-2 py-[2px] rounded-full bg-[#EFE9DB] text-[#5C665C] text-[11px] font-medium whitespace-nowrap">{t}</span>)}</span> : <span className="text-[#98A096]">—</span>}
                    </td>
                    <td className={`${tdCls} font-semibold text-[#8A551F] whitespace-nowrap`}>{money(item.price, currency)}</td>
                    <td className={tdCls}><Toggle on={item.isAvailable} onClick={() => void toggleAvailable(item)} label={`${item.isAvailable ? 'Hide' : 'Show'} ${item.name} on the public menu`} /></td>
                    <td className={tdCls}>
                      <span className="flex gap-2 justify-end">
                        <button className={chipGhostBtn} onClick={() => { setForm(item); setTagsText(item.tags.join(', ')); scrollToForm(); }}>Edit</button>
                        {isAdmin && <button className={chipDangerBtn} disabled={busy} onClick={() => void remove(item.id)}>Delete</button>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <form ref={formRef} onSubmit={save} className="bg-white border border-[#EAE3D3] rounded-[14px] shadow-[0_1px_2px_rgba(22,36,26,0.03),0_10px_24px_-18px_rgba(22,36,26,0.18)] p-6 grid md:grid-cols-2 gap-4 scroll-mt-24">
        <h2 className="font-display text-[22px] font-semibold text-[#16241A] md:col-span-2">{form.id ? 'Edit dish' : 'Add a dish'}</h2>
        <div><label className={labelCls} htmlFor="m-name">Name</label><input id="m-name" className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
        <div><label className={labelCls} htmlFor="m-cat">Category</label><input id="m-cat" className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} required /></div>
        <div className="md:col-span-2"><label className={labelCls} htmlFor="m-desc">Description</label><textarea id="m-desc" className={inputCls} rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        <div><label className={labelCls} htmlFor="m-price">Price ({currency})</label><input id="m-price" type="number" min="0" step="0.01" className={inputCls} value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} required /></div>
        <div><label className={labelCls} htmlFor="m-sort">Sort order</label><input id="m-sort" type="number" className={inputCls} value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} /></div>
        <div>
          <label className={labelCls} htmlFor="m-img">Image URL</label>
          <div className="flex gap-2">
            <input id="m-img" className={inputCls} value={form.image} onChange={(e) => setForm({ ...form, image: e.target.value })} />
            <button type="button" className={ghostBtn} disabled={busy} onClick={() => fileRef.current?.click()}>Upload</button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
          </div>
        </div>
        <div><label className={labelCls} htmlFor="m-tags">Dietary tags (comma separated)</label><input id="m-tags" className={inputCls} value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="Vegan, Gluten-Free" /></div>
        <label className="flex items-center gap-2 font-bodytext text-[13.5px] text-[#16241A] md:col-span-2">
          <input type="checkbox" checked={form.isAvailable} onChange={(e) => setForm({ ...form, isAvailable: e.target.checked })} className="accent-[#C17A3A] w-4 h-4" /> Available on the public menu
        </label>
        <div className="md:col-span-2 flex gap-2">
          <button type="submit" disabled={busy} className={primaryBtn}>{form.id ? 'Save changes' : 'Add dish'}</button>
          {form.id && <button type="button" className={ghostBtn} onClick={() => { setForm(EMPTY); setTagsText(''); }}>Cancel edit</button>}
        </div>
      </form>
    </div>
  );
}
