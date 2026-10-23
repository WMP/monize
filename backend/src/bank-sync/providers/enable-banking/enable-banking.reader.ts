import { Logger } from "@nestjs/common";
import type {
  BankReadProvider,
  BankSyncProvider,
  BankSyncCredentials,
  PsuContext,
  BankBalance,
} from "../bank-sync-provider.interface";

/** Transactions must be complete; an independent balance failure means unknown balance. */
export class EnableBankingReader implements BankReadProvider {
  private readonly logger = new Logger(EnableBankingReader.name);
  constructor(private readonly provider: BankSyncProvider) {}
  async readAccount(
    _userId: string,
    credentials: BankSyncCredentials,
    accountId: string,
    window: { dateFrom: string; dateTo: string },
    psu: PsuContext | null = null,
  ) {
    const transactions = await this.provider.fetchTransactions(
      credentials,
      accountId,
      window,
      psu,
    );
    let balance: BankBalance | null = null;
    try {
      balance = await this.provider.fetchBalance(credentials, accountId, psu);
    } catch {
      this.logger.warn(
        "Bank balance could not be read; transaction data is complete",
      );
    }
    return { transactions, balance, currencyCode: null, pending: 0 };
  }
}
