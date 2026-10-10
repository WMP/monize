import { NotFoundException } from "@nestjs/common";
import { EntityManager } from "typeorm";
import { tr } from "../i18n/translate";
import { INVESTMENT_REPLAY_ORDER_SQL } from "../securities/investment-replay.util";
import { BondLotTransaction } from "./bond-lots";

/** A linked security and its investment transactions, in register order. */
export interface BondLedger {
  readonly security: {
    readonly id: string;
    readonly userId: string;
    readonly symbol: string;
    readonly currencyCode: string;
    readonly bondInstrumentId: string;
  };
  readonly transactions: readonly BondLotTransaction[];
}

interface LedgerRow {
  action: string;
  status: string;
  tx_date: string;
  quantity: string | null;
  paired_transfer: boolean;
}

/**
 * Load the security and its ledger on the caller's transaction.
 *
 * Ownership is in the predicate (`user_id` from the JWT, never the request),
 * because `RLS_MODE` defaults to `off`; under enforcement RLS returns the same
 * zero rows. Another user's security, a missing one and an unlinked one are
 * all the same 404: the caller learns nothing about which.
 *
 * A reader of effects: VOID rows recorded nothing and are not read (the lot
 * derivation excludes them too, for a caller that passes raw rows). The
 * transactions are read across every account, in `INVESTMENT_REPLAY_ORDER_SQL`
 * (the order every ledger replay uses), with `quantity` as text so the lot
 * derivation can read it exactly. A transfer leg is `pairedTransfer` when the
 * other leg of the same security is linked to it and is not VOID (the link is
 * stored on one or both legs).
 */
export async function loadBondLedger(
  m: EntityManager,
  userId: string,
  securityId: string,
): Promise<BondLedger> {
  const securities: Array<{
    id: string;
    user_id: string;
    symbol: string;
    currency_code: string;
    bond_instrument_id: string | null;
  }> = await m.query(
    `SELECT id, user_id, symbol, currency_code, bond_instrument_id
       FROM securities
      WHERE id = $1 AND user_id = $2`,
    [securityId, userId],
  );
  const security = securities[0];
  if (!security || security.bond_instrument_id === null) {
    throw new NotFoundException(
      tr(
        "errors.bonds.securityNotLinked",
        `Security ${securityId} not found or not linked to a bond instrument`,
        { securityId },
      ),
    );
  }

  const rows: LedgerRow[] = await m.query(
    `SELECT t.action::text AS action,
            t.status,
            TO_CHAR(t.transaction_date, 'YYYY-MM-DD') AS tx_date,
            t.quantity::text AS quantity,
            EXISTS (
              SELECT 1 FROM investment_transactions p
               WHERE p.user_id = t.user_id
                 AND p.security_id = t.security_id
                 AND p.status != 'VOID'
                 AND p.action IN ('TRANSFER_IN', 'TRANSFER_OUT')
                 AND p.action <> t.action
                 AND (p.id = t.linked_transaction_id OR p.linked_transaction_id = t.id)
            ) AS paired_transfer
       FROM investment_transactions t
      WHERE t.security_id = $1 AND t.user_id = $2
        AND t.status != 'VOID'
      ORDER BY ${INVESTMENT_REPLAY_ORDER_SQL}`,
    [securityId, userId],
  );

  return {
    security: {
      id: security.id,
      userId: security.user_id,
      symbol: security.symbol,
      currencyCode: security.currency_code,
      bondInstrumentId: security.bond_instrument_id,
    },
    transactions: rows.map((r) => ({
      action: r.action,
      status: r.status,
      transactionDate: r.tx_date,
      quantity: r.quantity,
      pairedTransfer: r.paired_transfer === true,
    })),
  };
}
