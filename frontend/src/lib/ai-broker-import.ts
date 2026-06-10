import apiClient from './api';

/** One order parsed out of a broker's pasted order-history HTML. */
export interface BrokerImportParsedOrder {
  /** Stable id assigned by the parser, used as a React key and for tracking. */
  rowId: string;
  securityName: string;
  exchange: string | null;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  /** Gross trade value when the broker reported it, else null. */
  value: number | null;
  commission: number;
  currency: string;
  tradeDate: string;
  /** Existing security the parser matched, or null when none. */
  matchedSecurityId: string | null;
  matchedSecurityName: string | null;
}

export interface BrokerImportParseResponse {
  orders: BrokerImportParsedOrder[];
  model: string;
  warnings: string[];
}

/** A brand-new security to create as part of an apply. */
export interface BrokerImportNewSecurity {
  symbol: string;
  name: string;
  exchange?: string;
  currency: string;
  type?: string;
}

/** One order to apply as an investment transaction. */
export interface BrokerImportApplyOrder {
  /** Existing security id, when the user picked one. */
  securityId?: string;
  /** New security to create, when the user chose "Create new security". */
  newSecurity?: BrokerImportNewSecurity;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  commission: number;
  currency: string;
  tradeDate: string;
}

export interface BrokerImportApplyRequest {
  accountId: string;
  orders: BrokerImportApplyOrder[];
}

export interface BrokerImportApplyResponse {
  created: number;
  securitiesCreated: number;
  skipped: number;
  errors: string[];
}

export const brokerImportApi = {
  parse: async (html: string): Promise<BrokerImportParseResponse> => {
    // The LLM call can take many seconds, so override the default 10s timeout.
    const response = await apiClient.post<BrokerImportParseResponse>(
      '/ai/broker-import/parse',
      { html },
      { timeout: 120000 },
    );
    return response.data;
  },

  apply: async (
    body: BrokerImportApplyRequest,
  ): Promise<BrokerImportApplyResponse> => {
    const response = await apiClient.post<BrokerImportApplyResponse>(
      '/ai/broker-import/apply',
      body,
      { timeout: 120000 },
    );
    return response.data;
  },
};
