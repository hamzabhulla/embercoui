import { useEffect, useState } from 'react';
import { adminDownloadCsv, adminGet } from '../../services/adminApi';
import { ErrorNote, LoadingNote, PageTitle, fmtDate, primaryBtn } from '../../components/admin/ui';

interface Sub { email: string; createdAt: string }

export default function AdminNewsletter() {
  const [rows, setRows] = useState<Sub[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    adminGet<{ subscribers: Sub[] }>('/api/v1/admin/newsletter').then((d) => setRows(d.subscribers)).catch((e: Error) => setError(e.message));
  }, []);
  const download = async () => {
    try { await adminDownloadCsv('/api/v1/admin/newsletter.csv'); }
    catch (e) { setError((e as Error).message); }
  };
  return (
    <div>
      <PageTitle sub={`${rows.length} subscribers`}>Newsletter</PageTitle>
      {error && <ErrorNote message={error} />}
      <button className={`${primaryBtn} mb-8`} onClick={() => void download()}>Export CSV</button>
      {rows.length === 0 && !error && <LoadingNote />}
      <div className="space-y-2">
        {rows.map((s) => (
          <div key={s.email} className="flex justify-between bg-[#1C2B1E] border border-white/10 px-5 py-3">
            <span className="font-bodytext text-sm">{s.email}</span>
            <span className="font-bodytext text-xs text-[#F5F0E8]/45">{fmtDate(s.createdAt)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
