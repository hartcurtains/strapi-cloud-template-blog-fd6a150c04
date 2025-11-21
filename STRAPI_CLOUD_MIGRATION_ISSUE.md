# Strapi Cloud Migration Issue - Action Required

## Problem

Strapi Cloud is **still trying to run database migrations** despite our configuration to disable them. The error:

```
error: insert into "public"."strapi_database_schema" ("hash", "schema", "time") values ($1, $2, $3) - permission denied
```

This means Strapi Cloud is **overriding** or **ignoring** the `runMigrations: false` setting in `config/database.ts`.

## Why This Is Happening

Strapi Cloud has its own migration system that runs **before** or **independently** of your application configuration. This is a managed service behavior that cannot be disabled through code alone.

## Solutions (Choose One)

### Option 1: Contact Strapi Cloud Support (RECOMMENDED)

**This is the only reliable way to disable migrations on Strapi Cloud.**

1. Go to Strapi Cloud Dashboard
2. Open a support ticket
3. Request: **"Please disable automatic database migrations for my project. I want to manage the database schema manually."**
4. Provide your project details and explain that migrations are causing permission errors

**Why this works:** Strapi Cloud support can disable migrations at the platform level, which will override any automatic migration attempts.

### Option 2: Grant Database Permissions

If you have database admin access, grant permissions to the database user:

```sql
GRANT ALL PRIVILEGES ON TABLE public.strapi_database_schema TO your_database_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO your_database_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO your_database_user;
GRANT USAGE ON SCHEMA public TO your_database_user;
```

**Note:** This allows Strapi to run migrations, but you said you want NO scripts to run.

### Option 3: Use Environment Variable (May Not Work)

Try setting this in Strapi Cloud Environment Variables:

```
DATABASE_AUTO_MIGRATE=false
```

However, this likely won't work if Strapi Cloud is overriding the configuration.

## Current Configuration

We've configured `config/database.ts` with:
- `settings.runMigrations: false`
- `settings.autoMigrate: false`
- `connection.settings.runMigrations: false`
- `connection.settings.autoMigrate: false`

**But Strapi Cloud is still running migrations**, which means the platform is overriding our settings.

## What to Do Next

1. **Contact Strapi Cloud Support** - This is the most reliable solution
2. **Explain the issue:** You want to disable all automatic database migrations
3. **Reference this file** if needed
4. **Wait for their response** - They can disable migrations at the platform level

## Why Code Changes Won't Work

Strapi Cloud runs migrations as part of its deployment process, **before** your application code is fully loaded. This is a platform-level feature that requires platform-level configuration changes.

## Alternative: Use Strapi Cloud's Managed Database

If you're using Strapi Cloud's managed PostgreSQL database, they handle migrations automatically. You might need to:
- Accept that migrations will run (with proper permissions)
- Or use a custom database where you have full control

---

**Bottom Line:** You need to contact Strapi Cloud support to disable migrations. Code configuration alone cannot prevent Strapi Cloud from running its migration system.


