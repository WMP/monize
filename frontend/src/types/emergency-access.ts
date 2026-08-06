export interface EmergencyAccessContact {
  id: string;
  firstName: string;
  email: string;
  createdAt: string;
}

export interface EmergencyAccessMessageMetadata {
  hasMessage: boolean;
  charCount: number;
  updatedAt: string | null;
}

export interface EmergencyAccessView {
  emailConfigured: boolean;
  /**
   * Whether the server can encrypt a contact's claim link, which the grant path
   * requires so a retry re-sends the same link. Separate from `emailConfigured`
   * because they fail independently, and without it a grant silently delivers
   * nothing -- so the page says so rather than letting the toggle look armed.
   */
  credentialEncryptionConfigured: boolean;
  enabled: boolean;
  grantAfterDays: number;
  reminderAfterDays: number;
  messageMetadata: EmergencyAccessMessageMetadata;
  lastReminderSentAt: string | null;
  grantedAt: string | null;
  lastActivityAt: string | null;
  contacts: EmergencyAccessContact[];
}

export interface UpsertEmergencyAccessSettings {
  enabled: boolean;
  grantAfterDays: number;
  reminderAfterDays: number;
}

export interface UpsertEmergencyAccessContact {
  firstName: string;
  email: string;
}

export interface EmergencyAccessClaimPreview {
  ownerFirstName: string | null;
  ownerLastName: string | null;
  contactFirstName: string;
  message: string | null;
  expiresAt: string;
}
