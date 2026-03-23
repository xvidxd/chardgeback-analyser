import React, { useState, useRef } from 'react';
import { Chargeback } from '../types';
import { parseExcel, exportToExcel } from '../utils/excelParser';
import { Upload, Plus, Save, Edit2, X, Trash2, History, AlertCircle, Download } from 'lucide-react';
import { auth, db } from '../firebase';
import { doc, setDoc, deleteDoc, writeBatch, arrayUnion } from 'firebase/firestore';
import { handleFirestoreError } from '../App';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface DataManagementProps {
  chargebacks: Chargeback[];
  setChargebacks: React.Dispatch<React.SetStateAction<Chargeback[]>>;
}

export const DataManagement: React.FC<DataManagementProps> = ({ chargebacks, setChargebacks }) => {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Chargeback>>({});
  const [historyModalCb, setHistoryModalCb] = useState<Chargeback | null>(null);

  const [newCb, setNewCb] = useState<Partial<Chargeback>>({
    paymentDate: new Date().toISOString().split('T')[0],
    email: '',
    reasonCode: '',
    amount: 0,
    merchant: '',
    status: 'Pending',
    lossReason: '',
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !auth.currentUser) return;

    setIsUploading(true);
    setUploadError(null);
    try {
      const parsedData = await parseExcel(file);
      
      // Upload in batches of 500 (Firestore limit)
      const batchSize = 500;
      for (let i = 0; i < parsedData.length; i += batchSize) {
        const batch = writeBatch(db);
        const chunk = parsedData.slice(i, i + batchSize);
        
        chunk.forEach((cb) => {
          const docRef = doc(db, 'chargebacks', cb.id);
          const historyEntry = {
            timestamp: new Date().toISOString(),
            email: auth.currentUser!.email || 'unknown',
            action: 'Imported',
            details: 'Updated/Imported via Excel'
          };
          batch.set(docRef, { 
            ...cb, 
            uid: auth.currentUser!.uid, 
            history: arrayUnion(historyEntry) 
          }, { merge: true });
        });
        
        await batch.commit();
      }
    } catch (error: any) {
      console.error('Upload failed:', error);
      setUploadError(error.message || 'Failed to upload file. Please check the file format and try again.');
      handleFirestoreError(error, OperationType.WRITE, 'chargebacks');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleAddChargeback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser) return;

    const id = `cb-${Date.now()}`;
    const cb: Chargeback = {
      id,
      paymentDate: newCb.paymentDate || new Date().toISOString().split('T')[0],
      email: newCb.email || '',
      reasonCode: newCb.reasonCode || 'Unknown',
      amount: Number(newCb.amount) || 0,
      merchant: newCb.merchant || '',
      status: newCb.status as 'Won' | 'Lost' | 'Pending',
      lossReason: newCb.lossReason || '',
    };

    try {
      const historyEntry = {
        timestamp: new Date().toISOString(),
        email: auth.currentUser.email || 'unknown',
        action: 'Created',
        details: 'Added manually'
      };
      await setDoc(doc(db, 'chargebacks', id), { ...cb, uid: auth.currentUser.uid, history: [historyEntry] });
      setNewCb({
        paymentDate: new Date().toISOString().split('T')[0],
        email: '',
        reasonCode: '',
        amount: 0,
        merchant: '',
        status: 'Pending',
        lossReason: '',
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `chargebacks/${id}`);
    }
  };

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
      if (editForm.amount !== original.amount) changes.push(`Amount: ${original.amount} -> ${editForm.amount}`);
      if (editForm.merchant !== original.merchant) changes.push(`Merchant updated`);
      if (editForm.reasonCode !== original.reasonCode) changes.push(`Reason Code updated`);
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

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this chargeback?')) return;
    try {
      await deleteDoc(doc(db, 'chargebacks', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `chargebacks/${id}`);
    }
  };

  const handleExportExcel = () => {
    exportToExcel(chargebacks);
  };

  const handleDeleteAll = async () => {
    if (chargebacks.length === 0) return;
    if (!confirm('Are you ABSOLUTELY sure you want to delete ALL data? This action cannot be undone.')) return;
    
    try {
      const batchSize = 500;
      for (let i = 0; i < chargebacks.length; i += batchSize) {
        const batch = writeBatch(db);
        const chunk = chargebacks.slice(i, i + batchSize);
        chunk.forEach(cb => {
          batch.delete(doc(db, 'chargebacks', cb.id));
        });
        await batch.commit();
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'chargebacks');
    }
  };

  const formatEur = (amount: any) => {
    const num = Number(amount);
    const validAmount = isNaN(num) ? 0 : num;
    return new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(validAmount);
  };

  return (
    <div className="space-y-6">
      {uploadError && (
        <div className="p-4 bg-red-50 text-red-700 rounded-xl border border-red-100 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold">Upload Failed</h3>
            <p className="text-sm mt-1">{uploadError}</p>
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
        <div className="flex flex-wrap items-center gap-4">
          <input
            type="file"
            accept=".xlsx, .xls, .csv"
            className="hidden"
            ref={fileInputRef}
            onChange={handleFileUpload}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
          >
            <Upload className="w-4 h-4" />
            {isUploading ? 'Uploading...' : 'Upload Excel'}
          </button>
          
          <button
            onClick={handleExportExcel}
            disabled={chargebacks.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            Export Excel
          </button>
        </div>
        
        <button
          onClick={handleDeleteAll}
          disabled={chargebacks.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50"
        >
          <Trash2 className="w-4 h-4" />
          Delete All Data
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm p-6 border border-slate-100">
        <h3 className="text-lg font-semibold text-slate-800 mb-4">Add Manual Entry</h3>
        <form onSubmit={handleAddChargeback} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Payment Date</label>
            <input
              type="date"
              required
              value={newCb.paymentDate}
              onChange={(e) => setNewCb({ ...newCb, paymentDate: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input
              type="email"
              value={newCb.email}
              onChange={(e) => setNewCb({ ...newCb, email: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Reason Code</label>
            <input
              type="text"
              required
              value={newCb.reasonCode}
              onChange={(e) => setNewCb({ ...newCb, reasonCode: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Amount (€)</label>
            <input
              type="number"
              required
              min="0"
              step="0.01"
              value={newCb.amount}
              onChange={(e) => setNewCb({ ...newCb, amount: parseFloat(e.target.value) })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Merchant</label>
            <input
              type="text"
              value={newCb.merchant}
              onChange={(e) => setNewCb({ ...newCb, merchant: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Result (Status)</label>
            <select
              value={newCb.status}
              onChange={(e) => setNewCb({ ...newCb, status: e.target.value as any })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            >
              <option value="Pending">Pending</option>
              <option value="Won">Won</option>
              <option value="Lost">Lost</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <button
              type="submit"
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Chargeback
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
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
              {chargebacks.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                    No chargebacks found. Upload an Excel file or add one manually.
                  </td>
                </tr>
              ) : (
                chargebacks.map((cb) => (
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
                          <button
                            onClick={() => handleDelete(cb.id)}
                            className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
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
