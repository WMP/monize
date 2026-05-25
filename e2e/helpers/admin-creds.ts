import type { TestUser } from './api';

// Fixed credentials for the admin account. Global setup registers this as the
// very first user (first user => admin role) against the fresh e2e database;
// both global setup and the admin fixture import these constants directly (no
// secret is written to disk). The password reuses the standard E2E test
// credential value rather than introducing a new hard-coded secret.
export const ADMIN_CREDS: TestUser = {
  email: 'e2e-admin@monize.test',
  password: 'E2eTestPass123!',
  firstName: 'E2E',
  lastName: 'Admin',
};
