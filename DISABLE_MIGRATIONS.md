# Disabling Database Migrations in Strapi Cloud

## Problem
Strapi Cloud is trying to run database migrations on deployment, which causes permission errors:
```
error: insert into "public"."strapi_database_schema" ("hash", "schema", "time") values ($1, $2, $3) - permission denied
```

## Solution

The database configuration has been updated to disable automatic migrations. However, if you're still seeing this error, you may need to:

### Option 1: Set Environment Variable in Strapi Cloud

In your Strapi Cloud dashboard:
1. Go to **Settings** → **Environment Variables**
2. Add the following variable:
   ```
   DATABASE_AUTO_MIGRATE=false
   ```
3. Redeploy your application

### Option 2: Grant Database Permissions (If Option 1 Doesn't Work)

If Strapi Cloud still tries to run migrations, you'll need to grant permissions to the database user. Contact Strapi Cloud support to run:

```sql
GRANT ALL PRIVILEGES ON TABLE public.strapi_database_schema TO your_database_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO your_database_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO your_database_user;
GRANT USAGE ON SCHEMA public TO your_database_user;
```

### Option 3: Contact Strapi Cloud Support

If the above options don't work, contact Strapi Cloud support and ask them to:
1. Disable automatic migrations for your project
2. Or grant the necessary database permissions to your database user

## Current Configuration

The `config/database.ts` file has been configured with:
- `autoMigrate: false` - Prevents automatic schema migrations
- `runMigrations: false` - Prevents running migration scripts

This should prevent Strapi from attempting to modify the database schema on startup.

## Health Check Error

The second error you're seeing:
```
ERROR failed health checks after 6 attempts with error Readiness probe failed
```

This happens because Strapi fails to start due to the database permission error. Once the database issue is resolved, the health checks should pass.

## Verification

After applying the fix, verify that:
1. Strapi starts without database permission errors
2. Health checks pass successfully
3. No database schema modifications occur on deployment


