import type { Core } from '@strapi/strapi';
import importData from './bootstrap';
import fs from 'fs';
import fsPromises from 'fs/promises';

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

// Set up global unhandled rejection handler to prevent crashes from Windows file lock errors
// This must be set up before Strapi starts to catch all async errors
// Use prependListener to ensure this runs FIRST before any other handlers
const windowsFileLockHandler = (reason: any, promise: Promise<any>) => {
  // Check if it's a Windows file lock error
  const isWindowsError = reason?.code === 'EPERM' || 
                        reason?.errno === -4048 || // Windows EPERM errno
                        reason?.message?.includes('EPERM') ||
                        reason?.message?.includes('unlink') ||
                        reason?.message?.includes('operation not permitted') ||
                        reason?.syscall === 'unlink' ||
                        (reason?.path && reason.path.includes('Temp'));
  
  if (isWindowsError) {
    // Log but don't crash - this is just a cleanup error from file uploads
    console.warn(`⚠️ Caught unhandled Windows file lock error (non-fatal):`, 
      reason.message?.substring(0, 200) || reason.toString().substring(0, 200));
    // Suppress the error - don't crash the server
    return;
  }
  
  // For other errors, use default Node.js behavior (log and potentially exit)
  console.error('Unhandled Rejection:', reason);
};

// Remove any existing handlers first, then add ours as the first handler
const existingRejectionHandlers = process.listeners('unhandledRejection');
existingRejectionHandlers.forEach(handler => process.removeListener('unhandledRejection', handler));
process.prependListener('unhandledRejection', windowsFileLockHandler);
// Also add as regular listener in case prependListener doesn't work
process.on('unhandledRejection', windowsFileLockHandler);

// Also handle uncaught exceptions (Node.js converts unhandled rejections to exceptions)
const windowsFileLockExceptionHandler = (error: Error) => {
  // Check if it's a Windows file lock error
  const isWindowsError = (error as any)?.code === 'EPERM' || 
                        (error as any)?.errno === -4048 ||
                        error.message?.includes('EPERM') ||
                        error.message?.includes('unlink') ||
                        error.message?.includes('operation not permitted') ||
                        (error as any)?.syscall === 'unlink' ||
                        ((error as any)?.path && (error as any).path.includes('Temp'));
  
  if (isWindowsError) {
    // Log but don't crash - this is just a cleanup error from file uploads
    console.warn(`⚠️ Caught uncaught Windows file lock exception (non-fatal):`, 
      error.message?.substring(0, 200) || error.toString().substring(0, 200));
    // Suppress the error - don't crash the server
    return;
  }
  
  // For other errors, use default Node.js behavior (log and exit)
  console.error('Uncaught Exception:', error);
  process.exit(1);
};

// Handle uncaught exceptions (Node.js converts unhandled rejections to these)
const existingExceptionHandlers = process.listeners('uncaughtException');
existingExceptionHandlers.forEach(handler => process.removeListener('uncaughtException', handler));
process.prependListener('uncaughtException', windowsFileLockExceptionHandler);
process.on('uncaughtException', windowsFileLockExceptionHandler);

console.log('✅ Global unhandled rejection and uncaught exception handlers registered for Windows file lock errors');

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
    // Import data from git on first startup
    await importData({ strapi });
  },
};
