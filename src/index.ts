import type { Core } from '@strapi/strapi';
import importData from './bootstrap';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { registerCatalogueRefresh } from './api/storefront/services/catalogue-refresh';

// Development-only compatibility for transient Windows file locks. Never
// replace process-level failure handling in production.
if (process.platform === 'win32' && process.env.NODE_ENV !== 'production') {
// PATCH: Wrap fs.unlink to handle Windows file lock errors gracefully
// This prevents Strapi from crashing when temp files are locked on Windows
const originalUnlink = fs.unlink;
const originalUnlinkSync = fs.unlinkSync;
const originalUnlinkPromise = fsPromises.unlink;

// Safe unlink that ignores Windows file lock errors
const safeUnlink = (path: fs.PathLike, callback?: (err: NodeJS.ErrnoException | null) => void) => {
  originalUnlink(path, (err) => {
    if (err && (err.code === 'EPERM' || err.code === 'EBUSY' || err.errno === -4048)) {
      // Windows file lock - log but don't error
      console.warn(`⚠️ Windows file lock: skipping unlink for ${path} (non-fatal)`);
      if (callback) callback(null); // Success (ignored)
    } else if (callback) {
      callback(err);
    }
  });
};

const safeUnlinkSync = (path: fs.PathLike) => {
  try {
    originalUnlinkSync(path);
  } catch (err: any) {
    if (err.code === 'EPERM' || err.code === 'EBUSY' || err.errno === -4048) {
      // Windows file lock - log but don't error
      console.warn(`⚠️ Windows file lock: skipping unlinkSync for ${path} (non-fatal)`);
    } else {
      throw err;
    }
  }
};

const safeUnlinkPromise = async (path: fs.PathLike) => {
  try {
    await originalUnlinkPromise(path);
  } catch (err: any) {
    if (err.code === 'EPERM' || err.code === 'EBUSY' || err.errno === -4048) {
      // Windows file lock - log but don't error
      console.warn(`⚠️ Windows file lock: skipping unlink promise for ${path} (non-fatal)`);
      // Return successfully (error ignored)
    } else {
      throw err;
    }
  }
};

// Replace fs methods with safe versions
(fs as any).unlink = safeUnlink;
(fs as any).unlinkSync = safeUnlinkSync;
(fsPromises as any).unlink = safeUnlinkPromise;

console.log('✅ Patched fs.unlink methods to handle Windows file lock errors');
}

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    const confirmationEmail = require('./extensions/users-permissions/confirmation-email');
    const frontendOrigin = confirmationEmail.configuredOrigin('FRONTEND_URL');
    confirmationEmail.configuredOrigin('PUBLIC_URL');
    if (process.env.NODE_ENV === 'production') {
      const tokenSecret = String(process.env.EMAIL_CONFIRMATION_TOKEN_SECRET || '');
      if (tokenSecret.length < 32) {
        throw new Error('EMAIL_CONFIRMATION_TOKEN_SECRET must contain at least 32 characters');
      }
      const resetSecret = String(process.env.PASSWORD_RESET_TOKEN_SECRET || '');
      if (resetSecret.length < 32) {
        throw new Error('PASSWORD_RESET_TOKEN_SECRET must contain at least 32 characters');
      }
    }
    const usersPermissionsStore = strapi.store({ type: 'plugin', name: 'users-permissions' });
    const advancedSettings = (await usersPermissionsStore.get({ key: 'advanced' })) as Record<string, unknown> | null;
    if (!advancedSettings) {
      throw new Error('Users & Permissions advanced settings are unavailable');
    }
    const confirmationRedirect = `${frontendOrigin}/auth?confirmed=1`;
    if (
      advancedSettings.email_confirmation !== true ||
      advancedSettings.email_confirmation_redirection !== confirmationRedirect
    ) {
      await usersPermissionsStore.set({
        key: 'advanced',
        value: {
          ...advancedSettings,
          email_confirmation: true,
          email_confirmation_redirection: confirmationRedirect,
        },
      });
      strapi.log.info('Registration email confirmation is enabled by application policy');
    }

    // Strapi Cloud can disable repository user migrations, and this project
    // intentionally defaults DATABASE_RUN_MIGRATIONS to false. Apply PB-07
    // explicitly after content-type synchronization so production cannot boot
    // without the constraints required by the webhook claim SQL.
    if (process.env.NODE_ENV === 'production') {
      const stripeWebhookMigration = require('../database/migrations/2026.07.15T00.00.00.stripe-webhook-processing.js');
      await stripeWebhookMigration.up(strapi.db.connection);
    } else {
      console.info('[PB-07] migration skipped outside production');
    }

    // The migration can run before Strapi synchronizes new content types on a
    // fresh database. Re-run its idempotent index step after schema sync so
    // the composite staging uniqueness is present on the first boot as well.
    const stagingMigration = require('../database/migrations/2026.07.21T00.00.00.fabric-colour-staging.js');
    await stagingMigration.ensureIndexes(strapi.db.connection);

    // Automatic schema migrations are disabled in production. Apply the user
    // consent columns explicitly so registration can persist the submitted
    // GDPR and terms consent values.
    const userConsentMigration = require('../database/migrations/2026.08.10T00.00.00.user-consent-fields.js');
    await userConsentMigration.ensureColumns(strapi.db.connection);

    const confirmationTokenMigration = require('../database/migrations/2026.08.19T00.00.00.user-confirmation-token-expiry.js');
    await confirmationTokenMigration.ensureSchema(strapi.db.connection);
    const passwordResetMigration = require('../database/migrations/2026.08.19T00.05.00.user-password-reset-expiry.js');
    await passwordResetMigration.ensureSchema(strapi.db.connection);

    // Email delivery is an outbox-style ledger.  This project deliberately
    // disables Strapi's automatic database migrations, so create its table and
    // indexes explicitly before any payment/status transition can enqueue an
    // email intent.  The migration is idempotent and safe to run on every boot.
    const orderEmailDeliveryMigration = require('../database/migrations/2026.08.23T00.00.00.order-email-delivery.js');
    await orderEmailDeliveryMigration.up(strapi.db.connection);

    // Import data from git on first startup
    await importData({ strapi });

    // Catalogue mutations (including publish/unpublish updates) invalidate
    // the one-request storefront snapshot through a debounced server-only
    // trigger. Registration happens after bootstrap imports so startup repair
    // writes do not create a refresh storm.
    registerCatalogueRefresh(strapi);
  },
};
