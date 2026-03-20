import * as XLSX from 'xlsx';
import { Chargeback } from '../types';

const getFormattedDate = (val: any): string => {
  if (!val) return new Date().toISOString().split('T')[0];
  
  if (val instanceof Date) {
    return val.toISOString().split('T')[0];
  }
  
  if (typeof val === 'string' || typeof val === 'number') {
    const d = new Date(val);
    if (!isNaN(d.getTime())) {
      return d.toISOString().split('T')[0];
    }
    
    // Fallback for DD.MM.YYYY
    if (typeof val === 'string' && val.includes('.')) {
      const parts = val.split('.');
      if (parts.length === 3) {
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
      }
    }
  }
  
  return String(val);
};

const parseAmount = (val: any): number => {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  
  let str = String(val).trim();
  
  // Remove spaces and currency symbols
  str = str.replace(/[^\d.,-]/g, '');
  
  // Count commas and dots
  const commaCount = (str.match(/,/g) || []).length;
  const dotCount = (str.match(/\./g) || []).length;
  
  if (commaCount > 0 && dotCount > 0) {
    const lastComma = str.lastIndexOf(',');
    const lastDot = str.lastIndexOf('.');
    if (lastComma > lastDot) {
      // e.g. 1.234,56
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      // e.g. 1,234.56
      str = str.replace(/,/g, '');
    }
  } else if (commaCount > 1) {
    // e.g. 1,234,567
    str = str.replace(/,/g, '');
  } else if (dotCount > 1) {
    // e.g. 1.234.567
    str = str.replace(/\./g, '');
  } else if (commaCount === 1) {
    // e.g. 1234,56 or 1,234
    str = str.replace(',', '.');
  }
  
  const parsed = parseFloat(str);
  return isNaN(parsed) ? 0 : parsed;
};

export const parseExcel = async (file: File): Promise<Chargeback[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary', cellDates: true });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(worksheet);
        
        const chargebacks: Chargeback[] = json.map((row: any, index: number) => ({
          id: row.id || row.Id || row.ID || `cb-${Date.now()}-${index}`,
          paymentDate: getFormattedDate(row['дата платежа'] || row.date || row.Date),
          email: row['почта'] || row.email || row.Email || '',
          reasonCode: String(row['reason code'] || row.reason || row.Reason || 'Unknown'),
          amount: parseAmount(row['сумма'] || row.amount || row.Amount || row.sum || row.Sum),
          merchant: row['мерчант'] || row.merchant || row.Merchant || '',
          status: mapStatus(row['результат'] || row.status || row.Status),
          lossReason: row.lossReason || row['Loss Reason'] || row.comment || row.Comment || '',
        }));
        
        resolve(chargebacks);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = (error) => reject(error);
    reader.readAsBinaryString(file);
  });
};

const mapStatus = (status: any): 'Won' | 'Lost' | 'Pending' => {
  if (typeof status !== 'string') return 'Pending';
  const s = status.toLowerCase();
  if (s.includes('won') || s.includes('win') || s.includes('success') || s === 'выигран' || s === 'выиграно') return 'Won';
  if (s.includes('lost') || s.includes('loss') || s.includes('fail') || s === 'проигран' || s === 'проиграно') return 'Lost';
  return 'Pending';
};
