import React, { useEffect, useRef, useState } from 'react';
import { adminGet, adminSend } from '../../services/adminApi';
import { useAuth } from '../../context/AuthContext';
import { ErrorNote, LoadingNote, PageTitle, dangerBtn, ghostBtn, inputCls, labelCls, money, primaryBtn } from '../../components/admin/ui';

interface Item { id: number; name: string; description: string; price: number; image: string; category: string; tags: string[]; isAvailable: boolean; sortOrder: number }
const EMPTY: Omit<Item, 'id'> = { name: '', description: '', price: 0, image: '', category: '', tags: [], isAvailable: true, sortOrder: 0 };

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
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
      const dataBase64 = await fileToBase64(file);
      const res = await adminSend<{ url: string }>('POST', '/api/v1/admin/menu/upload', { filename: file.name, contentType: file.type, dataBase64 });
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
