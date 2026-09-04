/** Which source would answer a payee contact lookup, and whether one can. */
export interface PayeeLookupStatus {
  /**
   * True when a lookup can run at all -- Google Places is configured and
   * within its cap, or an AI provider is configured. False means a lookup
   * control has nothing to offer and is not drawn.
   */
  available: boolean;
  /** The source that would answer right now, or null when nothing can. */
  source: 'google-places' | 'ai' | null;
  aiConfigured: boolean;
  googlePlaces: {
    /**
     * Who configures Places here. `operator` means the deployment supplies the
     * key and only the on/off switch is the user's; `user` means this user
     * stored one; `none` means neither.
     */
    mode: 'operator' | 'user' | 'none';
    enabled: boolean;
    /** True when this month's cap is spent, so lookups have fallen back to AI. */
    capReached: boolean;
  };
}

/** The Google Places settings card's state. Never carries the key itself. */
export interface PayeeLookupSettings {
  mode: 'operator' | 'user' | 'none';
  configured: boolean;
  enabled: boolean;
  capEnabled: boolean;
  monthlyCap: number;
  /** `'****'` when a key is stored, else null. Shown as a placeholder. */
  apiKeyMasked: string | null;
  /**
   * False when a key is stored that this server cannot decrypt. Distinct from
   * having no key: the repair is to enter it again.
   */
  apiKeyReadable: boolean;
  usedThisMonth: number;
  /** False when the server holds no ENCRYPTION_KEY, so no key can be stored. */
  encryptionAvailable: boolean;
}

export interface UpdatePayeeLookupSettings {
  enabled?: boolean;
  /** A new key; `''` clears the stored one; omit to keep it. */
  apiKey?: string;
  capEnabled?: boolean;
  monthlyCap?: number;
}

export interface PayeeLookupKeyTestResult {
  available: boolean;
  error?: string;
}
