import React, { useEffect, useRef, useState } from 'react';
import { adminGet, adminSend } from '../../services/adminApi';
import { useAuth } from '../../context/AuthContext';
import { ErrorNote, LoadingNote, PageTitle, dangerBtn, ghostBtn, inputCls, labelCls, money, primaryBtn } from '../../components/admin/ui';

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

// The API runs as a serverless function whose request body is capped at
// 4.5 MB. Base64 inflates data by ~1.37x, so a file of ~3 MB or less
// (~4.1 MB encoded) always fits and is sent UNTOUCHED — PNG transparency
// and GIF animation survive. Larger files (typical phone photos) are
// downscaled/re-encoded as JPEG in the browser, retrying smaller until
// the encoded result provably fits; if nothing fits, the admin gets a
// clear error instead of a silent platform 413.
const SAFE_UPLOAD_BYTES = 3_000_000;
const MAX_ENCODED_CHARS = 4_400_000;

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

async function prepareImageUpload(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith('image/') || file.size <= SAFE_UPLOAD_BYTES) {
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

  const load = () => {
    adminGet<{ items: Item[] }>('/api/v1/admin/menu').then((d) => setItems(d.items)).catch((e: Error) => setError(e.message));
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

  return (
    <div>
      <PageTitle sub="Changes appear on the public menu immediately">Menu</PageTitle>
      {error && <ErrorNote message={error} />}
      {notice && <p className="font-bodytext text-sm text-[#4ade80] mb-4">{notice}</p>}
      <form onSubmit={save} className="bg-[#1C2B1E] border border-white/10 p-6 mb-10 grid md:grid-cols-2 gap-4">
        <div><label className={labelCls} htmlFor="m-name">Name</label><input id="m-name" className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
        <div><label className={labelCls} htmlFor="m-cat">Category</label><input id="m-cat" className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} required /></div>
        <div className="md:col-span-2"><label className={labelCls} htmlFor="m-desc">Description</label><textarea id="m-desc" className={inputCls} rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        <div><label className={labelCls} htmlFor="m-price">Price ($)</label><input id="m-price" type="number" min="0" step="0.01" className={inputCls} value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} required /></div>
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
        <label className="flex items-center gap-2 font-bodytext text-sm md:col-span-2">
          <input type="checkbox" checked={form.isAvailable} onChange={(e) => setForm({ ...form, isAvailable: e.target.checked })} className="accent-[#C17A3A]" /> Available on the public menu
        </label>
        <div className="md:col-span-2 flex gap-2">
          <button type="submit" disabled={busy} className={primaryBtn}>{form.id ? 'Save changes' : 'Add dish'}</button>
          {form.id && <button type="button" className={ghostBtn} onClick={() => { setForm(EMPTY); setTagsText(''); }}>Cancel edit</button>}
        </div>
      </form>
      {items.length === 0 && <LoadingNote />}
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 bg-[#1C2B1E] border border-white/10 px-5 py-4">
            <div className="flex items-center gap-4 min-w-0">
              {item.image && <img src={item.image} alt="" className="w-14 h-14 object-cover" />}
              <div>
                <p className="font-bodytext text-sm">{item.name} <span className="text-[#C17A3A]">{money(item.price)}</span></p>
                <p className="font-bodytext text-xs text-[#F5F0E8]/45">{item.category}{item.tags.length ? ` · ${item.tags.join(', ')}` : ''} · {item.isAvailable ? 'Available' : 'Hidden'}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button className={ghostBtn} onClick={() => void toggleAvailable(item)}>{item.isAvailable ? 'Hide' : 'Show'}</button>
              <button className={ghostBtn} onClick={() => { setForm(item); setTagsText(item.tags.join(', ')); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Edit</button>
              {isAdmin && <button className={dangerBtn} disabled={busy} onClick={() => void remove(item.id)}>Delete</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
