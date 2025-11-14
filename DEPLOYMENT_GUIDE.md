# Strapi Database Deployment Guide

This guide will help you migrate your local SQLite database to a cloud database (PostgreSQL) and deploy your Strapi instance.

## Prerequisites

1. **Cloud Database Provider** (choose one):
   - **Strapi Cloud** (recommended - includes database)
   - **Railway** (PostgreSQL)
   - **Supabase** (PostgreSQL)
   - **AWS RDS** (PostgreSQL)
   - **DigitalOcean** (PostgreSQL)
   - **Heroku Postgres**

2. **Install required tools**:
   ```bash
   npm install -g pg-dump
   # Or use Docker for database migration tools
   ```

## Method 1: Using Strapi Cloud (Easiest)

### Step 1: Export Data from Local Strapi

1. **Export your data using Strapi's built-in export**:
   ```bash
   cd hcbDBWIP
   npm run develop
   ```
   - Go to Settings → Transfer Tokens
   - Create a new Transfer Token
   - Use the Strapi CLI to export:
   ```bash
   npx strapi export --file backup.tar.gz
   ```

### Step 2: Deploy to Strapi Cloud

1. **Install Strapi Cloud CLI** (if not already installed):
   ```bash
   npm install -g @strapi/cloud-cli
   ```

2. **Login to Strapi Cloud**:
   ```bash
   strapi-cloud login
   ```

3. **Deploy your project**:
   ```bash
   cd hcbDBWIP
   strapi-cloud deploy
   ```

4. **Import your data**:
   ```bash
   npx strapi import --file backup.tar.gz
   ```

## Method 2: Manual Migration to PostgreSQL

### Step 1: Set Up Cloud PostgreSQL Database

1. **Create a PostgreSQL database** on your chosen provider
2. **Note down the connection details**:
   - Host
   - Port (usually 5432)
   - Database name
   - Username
   - Password
   - SSL connection string (if required)

### Step 2: Export Data from SQLite

1. **Install SQLite to PostgreSQL migration tool**:
   ```bash
   npm install --save-dev sqlite3 pg
   ```

2. **Create export script** (`hcbDBWIP/scripts/export-data.js`):
   ```javascript
   const sqlite3 = require('sqlite3').verbose();
   const fs = require('fs');
   const path = require('path');

   const dbPath = path.join(__dirname, '..', '.tmp', 'data.db');
   const db = new sqlite3.Database(dbPath);

   // Export all tables to JSON
   db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
     if (err) {
       console.error(err);
       return;
     }
     
     const data = {};
     let completed = 0;
     
     tables.forEach(table => {
       db.all(`SELECT * FROM ${table.name}`, (err, rows) => {
         if (err) {
           console.error(`Error exporting ${table.name}:`, err);
         } else {
           data[table.name] = rows;
         }
         completed++;
         if (completed === tables.length) {
           fs.writeFileSync('strapi-export.json', JSON.stringify(data, null, 2));
           console.log('Export complete!');
           db.close();
         }
       });
     });
   });
   ```

3. **Run the export**:
   ```bash
   cd hcbDBWIP
   node scripts/export-data.js
   ```

### Step 3: Update Environment Variables

1. **Create/Update `.env` file in `hcbDBWIP` directory**:
   ```env
   # Database Configuration
   DATABASE_CLIENT=postgres
   DATABASE_HOST=your-cloud-db-host.com
   DATABASE_PORT=5432
   DATABASE_NAME=your_database_name
   DATABASE_USERNAME=your_username
   DATABASE_PASSWORD=your_password
   DATABASE_SSL=true
   DATABASE_URL=postgresql://username:password@host:5432/database_name?sslmode=require

   # Strapi Configuration
   HOST=0.0.0.0
   PORT=1337
   APP_KEYS=your-app-keys-here
   API_TOKEN_SALT=your-api-token-salt-here
   ADMIN_JWT_SECRET=your-admin-jwt-secret-here
   TRANSFER_TOKEN_SALT=your-transfer-token-salt-here
   JWT_SECRET=your-jwt-secret-here
   ```

### Step 4: Migrate Schema and Data

1. **Install PostgreSQL client**:
   ```bash
   cd hcbDBWIP
   npm install pg
   ```

2. **Run Strapi migrations** (this will create the schema):
   ```bash
   npm run develop
   # Strapi will automatically create tables in PostgreSQL
   ```

3. **Import your data** using Strapi's import feature:
   - Use the Strapi Admin Panel → Settings → Transfer → Import
   - Or use the CLI: `npx strapi import --file backup.tar.gz`

### Step 5: Deploy Strapi Application

#### Option A: Deploy to Strapi Cloud
```bash
cd hcbDBWIP
npm run deploy
# Follow the prompts
```

#### Option B: Deploy to Railway
1. Install Railway CLI: `npm i -g @railway/cli`
2. Login: `railway login`
3. Initialize: `railway init`
4. Link database: `railway add postgresql`
5. Deploy: `railway up`

#### Option C: Deploy to VPS/Server
1. Build the project:
   ```bash
   npm run build
   ```

2. Set production environment variables

3. Start with PM2:
   ```bash
   npm install -g pm2
   pm2 start npm --name "strapi" -- start
   ```

## Method 3: Using Strapi Transfer (Recommended for Data Migration)

### Step 1: Export from Local

1. **Start your local Strapi**:
   ```bash
   cd hcbDBWIP
   npm run develop
   ```

2. **Create Transfer Token**:
   - Go to http://localhost:1337/admin
   - Settings → Transfer Tokens → Create new token
   - Copy the token

3. **Export data**:
   ```bash
   npx strapi export --file backup.tar.gz --token YOUR_TRANSFER_TOKEN
   ```

### Step 2: Set Up Cloud Database

1. Create PostgreSQL database on your cloud provider
2. Update `.env` with cloud database credentials

### Step 3: Import to Cloud

1. **Deploy Strapi to cloud** (empty database first)
2. **Create Transfer Token** on cloud instance
3. **Import data**:
   ```bash
   npx strapi import --file backup.tar.gz --token CLOUD_TRANSFER_TOKEN
   ```

## Important Notes

1. **Media Files**: Don't forget to upload your media files (`public/uploads/`) to your cloud storage/CDN
2. **Environment Variables**: Keep your `.env` file secure and never commit it to Git
3. **Backup**: Always backup your local database before migration
4. **SSL**: Most cloud databases require SSL connections - set `DATABASE_SSL=true`
5. **Connection Pooling**: Adjust pool settings if needed for your database size

## Troubleshooting

### Connection Issues
- Verify database credentials
- Check firewall rules allow your IP
- Ensure SSL is properly configured

### Migration Errors
- Check Strapi logs for specific errors
- Verify all required environment variables are set
- Ensure database user has proper permissions

### Data Loss Prevention
- Always test migration on a staging environment first
- Keep backups of both local and cloud databases
- Verify data integrity after migration

## Quick Reference Commands

```bash
# Export data
npx strapi export --file backup.tar.gz

# Import data
npx strapi import --file backup.tar.gz

# Deploy to Strapi Cloud
npm run deploy

# Build for production
npm run build

# Start production server
npm run start
```

