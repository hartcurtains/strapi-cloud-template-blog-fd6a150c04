# Fix Database Permissions Error

## Problem
Strapi is failing to start with the error:
```
permission denied for table strapi_database_schema
```

This occurs because the PostgreSQL database user doesn't have INSERT permissions on the `strapi_database_schema` table.

## Solution

### Option 1: Using SQL Script (Recommended)

1. Connect to your PostgreSQL database as a superuser (usually `postgres`):
   ```bash
   psql -U postgres -d your_database_name
   ```

2. Run the SQL script:
   ```bash
   psql -U postgres -d your_database_name -f scripts/fix-database-permissions.sql
   ```

   Or if you're already in psql:
   ```sql
   \i scripts/fix-database-permissions.sql
   ```

### Option 2: Manual SQL Commands

If you prefer to run commands manually, connect to your database and execute:

```sql
-- Grant permissions on the strapi_database_schema table
GRANT ALL PRIVILEGES ON TABLE public.strapi_database_schema TO strapi;

-- Grant permissions on all existing tables
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO strapi;

-- Grant permissions on sequences
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO strapi;

-- Grant usage on schema
GRANT USAGE ON SCHEMA public TO strapi;

-- Set default privileges for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO strapi;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO strapi;
```

Replace `strapi` with your actual database username if different.

### Option 3: For Containerized Environments (Docker/Kubernetes)

If you're running in a container, you can execute the SQL script from within the container:

```bash
# For Docker
docker exec -i your_postgres_container psql -U postgres -d your_database_name < scripts/fix-database-permissions.sql

# For Kubernetes
kubectl exec -i your_postgres_pod -- psql -U postgres -d your_database_name < scripts/fix-database-permissions.sql
```

### Option 4: Using Environment Variables

If you have access to your database connection string, you can use it directly:

```bash
psql $DATABASE_URL -f scripts/fix-database-permissions.sql
```

## Verify the Fix

After running the script, verify the permissions:

```sql
\dp strapi_database_schema
```

You should see the `strapi` user (or your database user) listed with INSERT, SELECT, UPDATE, DELETE permissions.

## Restart Strapi

After fixing the permissions, restart your Strapi application:

```bash
npm run start
# or
npm run develop
```

## Notes

- The `strapi_database_schema` table is used by Strapi to track database schema migrations
- If the table doesn't exist, the script will create it automatically
- Make sure you're using a database user with appropriate permissions, or run the script as a superuser

