import { useEffect, useState } from 'react';
import { adminGet } from '../../services/adminApi';
import { ErrorNote, LoadingNote, PageTitle, money } from '../../components/admin/ui';

interface Customer { id: string; email: string | null; fullName: string | null; phone: string | null; role: string; createdAt: string; orderCount: number; totalSpent: number }

export default function AdminCustomers() {
  const [rows, setRows] = useState<Customer[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    adminGet<{ customers: Customer[] }>('/api/v1/admin/customers').then((d) => setRows(d.customers)).catch((e: Error) => setError(e.message));
  }, []);
  return (
    <div>
      <PageTitle sub="Registered customers and their ordering history">Customers</PageTitle>
      {error && <ErrorNote message={error} />}
      {rows.length === 0 && !error && <LoadingNote />}
      <div className="space-y-3">
        {rows.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 bg-[#1C2B1E] border border-white/10 px-5 py-4">
            <div>
              <p className="font-bodytext text-sm">{c.fullName ?? '—'} <span className="text-[#F5F0E8]/45">{c.email ?? ''}</span></p>
              <p className="font-bodytext text-xs text-[#F5F0E8]/45">{c.phone ?? 'No phone'} · Joined {new Date(c.createdAt).toLocaleDateString()} · {c.role}</p>
            </div>
            <p className="font-bodytext text-sm">{c.orderCount} orders · <span className="text-[#C17A3A]">{money(c.totalSpent)}</span> spent</p>
          </div>
        ))}
      </div>
    </div>
  );
}
