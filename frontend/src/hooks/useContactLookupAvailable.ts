'use client';

import { useEffect, useState } from 'react';
import { payeeLookupApi } from '@/lib/payee-lookup';
import type { PayeeLookupStatus } from '@/types/payee-lookup';

export interface ContactLookupAvailability {
  /**
   * True only when the server said a lookup can actually run -- Google Places
   * within its cap, or an AI provider. A request still in flight, or one that
   * failed, leaves it false: "we could not ask" is not "a source exists", and
   * a surface that offered a paid lookup on a guess would fail at the click.
   */
  available: boolean;
  /** False until the status request settles, whether it answered or failed. */
  resolved: boolean;
  /** Which source would answer, for copy that names it. Null when none can. */
  source: PayeeLookupStatus['source'];
  /**
   * Whether an AI provider exists. The Payee Lookup settings section reads it
   * to decide whether ordering the two sources is a choice worth offering:
   * with only one source configured there is nothing to order.
   */
  aiConfigured: boolean;
}

/**
 * Whether this user can look a payee's contact details up at all.
 *
 * Every surface offering a lookup asks here rather than asking whether an AI
 * provider exists: since Google Places can answer instead, `useAiConfigured`
 * would hide the button from a user who configured Places and no AI -- exactly
 * the configuration this feature exists to support. `useAiConfigured` remains
 * correct for the assistant and its own toggle, which genuinely need a model.
 *
 * The read is cached and deduped in `payeeLookupApi.getStatus`, so mounting
 * this on the payee form, the detail card and the transaction page costs one
 * request; a settings save or an AI provider change drops that cache.
 */
export function useContactLookupAvailable(): ContactLookupAvailability {
  const [state, setState] = useState<ContactLookupAvailability>({
    available: false,
    resolved: false,
    source: null,
    aiConfigured: false,
  });

  useEffect(() => {
    let active = true;
    payeeLookupApi
      .getStatus()
      .then((status) => {
        if (active) {
          setState({
            available: status.available,
            resolved: true,
            source: status.source,
            aiConfigured: status.aiConfigured,
          });
        }
      })
      .catch(() => {
        // Nothing to tell the user here: the surfaces reading this simply do
        // not offer the lookup, and one that runs anyway still reports the
        // server's own reason.
        if (active)
          setState({
            available: false,
            resolved: true,
            source: null,
            aiConfigured: false,
          });
      });
    return () => {
      active = false;
    };
  }, []);

  return state;
}
