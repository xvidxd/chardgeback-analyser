export interface ChargebackHistory {
  timestamp: string;
  email: string;
  action: 'Created' | 'Updated' | 'Deleted';
  details?: string;
}

export interface Chargeback {
  id: string;
  paymentDate: string;
  email: string;
  reasonCode: string;
  amount: number;
  merchant: string;
  status: 'Won' | 'Lost' | 'Pending';
  lossReason?: string;
  uid?: string;
  history?: ChargebackHistory[];
}
