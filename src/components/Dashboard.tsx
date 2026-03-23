import React, { useMemo, useState } from 'react';
import { Chargeback } from '../types';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { AlertCircle, CheckCircle, XCircle, Clock, Wallet, TrendingDown, Edit2, Save, X, Calendar, FilterX, History } from 'lucide-react';
import { auth, db } from '../firebase';
import { doc, setDoc, arrayUnion } from 'firebase/firestore';
import { handleFirestoreError } from '../App';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface DashboardProps {
  chargebacks: Chargeback[];
  setChargebacks: React.Dispatch<React.SetStateAction<Chargeback[]>>;
}

const COLORS = ['#10b981', '#ef4444', '#f59e0b']; // Won, Lost, Pending

export const Dashboard: React.FC<DashboardProps> = ({ chargebacks }) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Chargeback>>({});
  const [historyModalCb, setHistoryModalCb] = useState<Chargeback | null>(null);
  
  // Date filter state
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const filteredChargebacks = useMemo(() => {
    return chargebacks.filter((cb) => {
      if (!startDate && !endDate) return true;
      
      const cbDate = new Date(cb.paymentDate);
      if (isNaN(cbDate.getTime())) return true; // If date is invalid, don't filter it out

      // Normalize to midnight for accurate day comparison
      cbDate.setHours(0, 0, 0, 0);

      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        if (cbDate < start) return false;
      }
      
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        if (cbDate > end) return false;
      }
      
      return true;
    });
  }, [chargebacks, startDate, endDate]);

  const stats = useMemo(() => {
    const total = filteredChargebacks.length;
    const won = filteredChargebacks.filter((cb) => cb.status === 'Won').length;
    const lost = filteredChargebacks.filter((cb) => cb.status === 'Lost').length;
    const pending = filteredChargebacks.filter((cb) => cb.status === 'Pending').length;

    const amountWon = filteredChargebacks
      .filter((cb) => cb.status === 'Won')
      .reduce((sum, cb) => sum + (Number(cb.amount) || 0), 0);
      
    const amountLost = filteredChargebacks
      .filter((cb) => cb.status === 'Lost')
      .reduce((sum, cb) => sum + (Number(cb.amount) || 0), 0);

    const winRate = total > 0 ? ((won / total) * 100).toFixed(1) : '0';
    const lossRate = total > 0 ? ((lost / total) * 100).toFixed(1) : '0';

    const reasonsCount = filteredChargebacks.reduce((acc, cb) => {
      acc[cb.reasonCode] = (acc[cb.reasonCode] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const topReasons = Object.entries(reasonsCount)
      .map(([name, value]) => ({ name, value: value as number }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    const statusData = [
      { name: 'Won', value: won },
      { name: 'Lost', value: lost },
      { name: 'Pending', value: pending },
    ];

    return { total, won, lost, pending, winRate, lossRate, amountWon, amountLost, topReasons, statusData };
  }, [filteredChargebacks]);

  const startEditing = (cb: Chargeback) => {
    setEditingId(cb.id);
    setEditForm(cb);
  };

  const saveEdit = async () => {
    if (!editingId || !auth.currentUser) return;
    
    const original = chargebacks.find(c => c.id === editingId);
    const changes: string[] = [];
    if (original) {
      if (editForm.status && editForm.status !== original.status) changes.push(`Status: ${original.status} -> ${editForm.status}`);
      if (editForm.lossReason !== original.lossReason) changes.push(`Comment updated`);
    }

    const historyEntry = {
      timestamp: new Date().toISOString(),
      email: auth.currentUser.email || 'unknown',
      action: 'Updated',
      details: changes.length > 0 ? changes.join(', ') : 'Edited record'
    };

    try {
      await setDoc(doc(db, 'chargebacks', editingId), { 
        ...editForm, 
        history: arrayUnion(historyEntry) 
      }, { merge: true });
      setEditingId(null);
      setEditForm({});
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `chargebacks/${editingId}`);
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const clearFilters = () => {
    setStartDate('');
    setEndDate('');
  };

  const formatEur = (amount: any) => {
    const num = Number(amount);
    const validAmount = isNaN(num) ? 0 : num;
    return new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(validAmount);
  };

  return (
    <div className="space-y-6">
      {/* Date Filter */}
      <div className="bg-white rounded-xl shadow-sm p-4 border border-slate-100 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="flex items-center gap-2 text-slate-700 font-medium">
          <Calendar className="w-5 h-5 text-indigo-600" />
          <span>Period:</span>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-500">From</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-500">To</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          {(startDate || endDate) && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              <FilterX className="w-4 h-4" />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl shadow-sm p-6 border border-slate-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Total Chargebacks</p>
              <p className="text-3xl font-semibold text-slate-900 mt-1">{stats.total}</p>
            </div>
            <div className="p-3 bg-blue-50 rounded-lg">
              <AlertCircle className="w-6 h-6 text-blue-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6 border border-slate-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Saved Amount (Won)</p>
              <p className="text-3xl font-semibold text-emerald-600 mt-1">{formatEur(stats.amountWon)}</p>
            </div>
            <div className="p-3 bg-emerald-50 rounded-lg">
              <Wallet className="w-6 h-6 text-emerald-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6 border border-slate-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Lost Amount</p>
              <p className="text-3xl font-semibold text-red-600 mt-1">{formatEur(stats.amountLost)}</p>
            </div>
            <div className="p-3 bg-red-50 rounded-lg">
              <TrendingDown className="w-6 h-6 text-red-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6 border border-slate-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Win Rate</p>
              <p className="text-3xl font-semibold text-emerald-600 mt-1">{stats.winRate}%</p>
            </div>
            <div className="p-3 bg-emerald-50 rounded-lg">
              <CheckCircle className="w-6 h-6 text-emerald-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6 border border-slate-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Loss Rate</p>
              <p className="text-3xl font-semibold text-red-600 mt-1">{stats.lossRate}%</p>
            </div>
            <div className="p-3 bg-red-50 rounded-lg">
              <XCircle className="w-6 h-6 text-red-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6 border border-slate-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Pending</p>
              <p className="text-3xl font-semibold text-amber-500 mt-1">{stats.pending}</p>
            </div>
            <div className="p-3 bg-amber-50 rounded-lg">
              <Clock className="w-6 h-6 text-amber-500" />
            </div>
          </div>
        </div>
      </div>

      {/* Charts */}
      {filteredChargebacks.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl shadow-sm p-6 border border-slate-100">
            <h3 className="text-lg font-semibold text-slate-800 mb-4">Win / Loss Ratio</h3>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={stats.statusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {stats.statusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6 border border-slate-100">
            <h3 className="text-lg font-semibold text-slate-800 mb-4">Top 5 Reason Codes</h3>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.topReasons} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" />
                  <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#6366f1" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Chargebacks List */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden mt-8">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
          <h3 className="text-lg font-semibold text-slate-800">
            Chargebacks {startDate || endDate ? '(Filtered)' : ''}
          </h3>
          <span className="text-sm text-slate-500">{filteredChargebacks.length} records</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 text-slate-700 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 font-medium">Payment Date</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Reason Code</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Merchant</th>
                <th className="px-4 py-3 font-medium">Result</th>
                <th className="px-4 py-3 font-medium">Loss Reason / Comment</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredChargebacks.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                    No chargebacks found for the selected period.
                  </td>
                </tr>
              ) : (
                filteredChargebacks.map((cb) => (
                  <tr key={cb.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap">{cb.paymentDate}</td>
                    <td className="px-4 py-3">{cb.email}</td>
                    <td className="px-4 py-3">{cb.reasonCode}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{formatEur(cb.amount)}</td>
                    <td className="px-4 py-3">{cb.merchant}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {editingId === cb.id ? (
                        <select
                          value={editForm.status}
                          onChange={(e) => setEditForm({ ...editForm, status: e.target.value as any })}
                          className="px-2 py-1 border border-slate-300 rounded text-sm"
                        >
                          <option value="Pending">Pending</option>
                          <option value="Won">Won</option>
                          <option value="Lost">Lost</option>
                        </select>
                      ) : (
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            cb.status === 'Won'
                              ? 'bg-emerald-100 text-emerald-800'
                              : cb.status === 'Lost'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {cb.status}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {editingId === cb.id ? (
                        <input
                          type="text"
                          value={editForm.lossReason || ''}
                          onChange={(e) => setEditForm({ ...editForm, lossReason: e.target.value })}
                          placeholder="Add comment..."
                          className="w-full px-2 py-1 border border-slate-300 rounded text-sm"
                        />
                      ) : (
                        <span className="text-slate-500">{cb.lossReason || '-'}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right">
                      {editingId === cb.id ? (
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={saveEdit} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded">
                            <Save className="w-4 h-4" />
                          </button>
                          <button onClick={cancelEdit} className="p-1 text-slate-400 hover:bg-slate-100 rounded">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setHistoryModalCb(cb)}
                            className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                            title="View History"
                          >
                            <History className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => startEditing(cb)}
                            className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* History Modal */}
      {historyModalCb && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] flex flex-col">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center">
              <h3 className="text-lg font-semibold text-slate-800">History: {historyModalCb.merchant}</h3>
              <button onClick={() => setHistoryModalCb(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              {historyModalCb.history && historyModalCb.history.length > 0 ? (
                <div className="space-y-4">
                  {[...historyModalCb.history].reverse().map((entry, idx) => (
                    <div key={idx} className="flex gap-3 text-sm">
                      <div className="w-2 h-2 mt-1.5 rounded-full bg-indigo-500 shrink-0" />
                      <div>
                        <p className="text-slate-800 font-medium">
                          {entry.action} by <span className="text-indigo-600">{entry.email}</span>
                        </p>
                        <p className="text-slate-500 text-xs mt-0.5">
                          {new Date(entry.timestamp).toLocaleString()}
                        </p>
                        {entry.details && (
                          <p className="text-slate-600 mt-1 bg-slate-50 p-2 rounded border border-slate-100">
                            {entry.details}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-slate-500 text-center py-4">No history available for this record.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
