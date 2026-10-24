import {
  MnyTransaction,
  MnyTransactionSplit,
  MnyTransfer,
} from "../model/mny-rows";
import {
  toAmount,
  toDate,
  toHandle,
  toInteger,
  toOptionalText,
} from "../model/mny-values";
import { MnyDatabase } from "../msisam/open-mny";
import { RowSpec, TableAvailability, readTableByName } from "./table-reader";

/**
 * Readers for `TRN`, `TRN_SPLIT` and `TRN_XFER`.
 *
 * The one version alias that matters lives here: Money Plus moved the payee
 * handle from `hpay` to `lHpay`. A file has exactly one of the two, so reading
 * only `hpay` silently drops every payee on a Money Plus file -- the newest
 * name is therefore listed first.
 */

const TRANSACTION_SPEC: RowSpec<MnyTransaction> = {
  handle: { from: "htrn", as: toHandle },
  account: { from: "hacct", as: toHandle },
  linkedAccount: { from: "hacctLink", as: toHandle },
  payee: { from: ["lHpay", "hpay"], as: toHandle },
  category: { from: "hcat", as: toHandle },
  security: { from: "hsec", as: toHandle },
  date: { from: "dt", as: toDate },
  amount: { from: "amt", as: toAmount },
  clearedStatus: { from: "cs", as: toInteger },
  flags: { from: "grftt", as: toInteger },
  action: { from: "act", as: (value) => toInteger(value, -1) },
  frequency: { from: "frq", as: (value) => toInteger(value, -1) },
  reference: { from: "szId", as: toOptionalText },
  memo: { from: "mMemo", as: toOptionalText },
  billSeries: { from: "hbillHead", as: toHandle },
  // Money writes -1 for "no classification", which `toHandle` reads as null.
  classification1: { from: "lHcls1", as: toHandle },
  classification2: { from: "lHcls2", as: toHandle },
};

const SPLIT_SPEC: RowSpec<MnyTransactionSplit> = {
  child: { from: "htrn", as: toHandle },
  parent: { from: "htrnParent", as: toHandle },
  position: { from: "iSplit", as: toInteger },
};

const TRANSFER_SPEC: RowSpec<MnyTransfer> = {
  from: { from: "htrnFrom", as: toHandle },
  to: { from: "htrnLink", as: toHandle },
};

export interface MnyTransactionData {
  readonly transactions: MnyTransaction[];
  readonly splits: MnyTransactionSplit[];
  readonly transfers: MnyTransfer[];
  readonly availability: readonly TableAvailability[];
}

export function readTransactionData(db: MnyDatabase): MnyTransactionData {
  const transactions = readTableByName(db, "TRN", TRANSACTION_SPEC);
  const splits = readTableByName(db, "TRN_SPLIT", SPLIT_SPEC);
  const transfers = readTableByName(db, "TRN_XFER", TRANSFER_SPEC);

  return {
    transactions: transactions.rows,
    splits: splits.rows,
    transfers: transfers.rows,
    availability: [
      transactions.availability,
      splits.availability,
      transfers.availability,
    ],
  };
}
