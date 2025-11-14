# Quick Deploy Guide - Strapi Local to Cloud

## Fastest Method: Using Strapi Transfer (Recommended)

### Step 1: Export from Local (5 minutes)

```bash
cd hcbDBWIP

# Start Strapi locally (if not already running)
npm run develop
```

**In another terminal:**
```bash
cd hcbDBWIP

# Export all data using Strapi's built-in transfer
npm run export
```

This creates `backup.tar.gz` with all your content, media references, and schema.

### Step 2: Set Up Cloud Database

Choose a provider and create a PostgreSQL database:

**Option A: Strapi Cloud** (Easiest - includes database)
- Go to https://cloud.strapi.io
- Create new project
- Follow setup wizard

**Option B: Railway** (Free tier available)
- Go to https://railway.app
- Create PostgreSQL database
- Copy connection string

**Option C: Supabase** (Free tier available)
- Go to https://supabase.com
- Create new project
- Copy connection details

### Step 3: Update Environment Variables

Create/update `.env` file in `hcbDBWIP` directory:

```env
# Change from SQLite to PostgreSQL
DATABASE_CLIENT=postgres

# Your cloud database credentials
DATABASE_HOST=your-db-host.com
DATABASE_PORT=5432
DATABASE_NAME=your_database_name
DATABASE_USERNAME=your_username
DATABASE_PASSWORD=your_password
DATABASE_SSL=true

# Or use connection string (easier)
DATABASE_URL=postgresql://username:password@host:5432/database_name?sslmode=require

# Keep your existing secrets (don't change these)
APP_KEYS=your-existing-app-keys
API_TOKEN_SALT=your-existing-salt
ADMIN_JWT_SECRET=your-existing-secret
TRANSFER_TOKEN_SALT=your-existing-salt
JWT_SECRET=your-existing-secret
```

### Step 4: Deploy Strapi

**If using Strapi Cloud:**
```bash
npm run deploy
# Follow the prompts
```

**If using Railway:**
```bash
npm install -g @railway/cli
railway login
railway init
railway add postgresql
railway up
```

**If using other providers:**
1. Build: `npm run build`
2. Set environment variables on your hosting platform
3. Deploy using your platform's method

### Step 5: Import Your Data

Once your cloud Strapi is running:

```bash
# Get transfer token from cloud Strapi admin panel
# Settings → Transfer Tokens → Create new token

# Import your data
npm run import
# Or: npx strapi import --file backup.tar.gz --token YOUR_CLOUD_TOKEN
```

### Step 6: Upload Media Files

Don't forget to upload your media files:

```bash
# Your media files are in:
hcbDBWIP/public/uploads/

# Upload these to:
# - Strapi Cloud: Automatic
# - Other providers: Use their file storage (S3, Cloudinary, etc.)
```

## Troubleshooting

**"Database connection failed"**
- Check your DATABASE_URL or credentials
- Verify SSL is enabled (most cloud DBs require it)
- Check firewall allows your IP

**"Import failed"**
- Make sure transfer token is valid
- Check file size limits
- Verify both Strapi versions match

**"Media files missing"**
- Upload `public/uploads/` folder to cloud storage
- Update media URLs in Strapi settings if needed

## Quick Commands Reference

```bash
# Export data
npm run export

# Import data  
npm run import

# Deploy to Strapi Cloud
npm run deploy

# Export raw SQLite data (alternative)
npm run export:data
```

## Next Steps

1. ✅ Export local data
2. ✅ Set up cloud database
3. ✅ Update .env file
4. ✅ Deploy Strapi
5. ✅ Import data
6. ✅ Upload media files
7. ✅ Test your cloud instance
8. ✅ Update your Next.js app's STRAPI_URL

