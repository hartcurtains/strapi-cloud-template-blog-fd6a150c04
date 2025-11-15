# Transfer Product Data to Strapi Cloud

## Current Situation
- ✅ Your code is uploaded to GitHub
- ❌ Your product data is NOT uploaded (it's only in local SQLite database)
- The database file (`.tmp/data.db`) is in `.gitignore` so it's not in the repository

## Solution: Export from Local → Import to Cloud

### Step 1: Create Transfer Token in LOCAL Strapi

1. Open your **local** Strapi admin: http://localhost:1337/admin
2. Go to: **Settings** → **Transfer Tokens**
3. Click **"Create new transfer token"**
4. Name it: "Local Export Token"
5. **Copy the token immediately** (you won't see it again!)

### Step 2: Export Data from Local

In PowerShell (in the hcbDBWIP directory):

```powershell
npx strapi export --file strapi-data-backup.tar.gz
```

When prompted, enter the transfer token you just created.

This creates `strapi-data-backup.tar.gz` with ALL your:
- Products (fabrics, curtains, blinds, cushions, etc.)
- Orders
- Users
- Media file references
- Content relationships

### Step 3: Create Transfer Token in CLOUD Strapi

1. Open your **cloud** Strapi admin: https://celebrated-feast-8b6e91b21c.strapiapp.com/admin
2. Go to: **Settings** → **Transfer Tokens**
3. Click **"Create new transfer token"**
4. Name it: "Cloud Import Token"
5. **Copy the token immediately**

### Step 4: Import Data to Cloud

In PowerShell:

```powershell
npx strapi import --file strapi-data-backup.tar.gz --token YOUR_CLOUD_TRANSFER_TOKEN
```

Replace `YOUR_CLOUD_TRANSFER_TOKEN` with the token from Step 3.

### Step 5: Upload Media Files

Your media files are in: `hcbDBWIP/public/uploads/`

You need to upload these to Strapi Cloud:
- Option 1: Use Strapi Cloud's media library (upload manually)
- Option 2: Use Strapi's media import feature
- Option 3: The import should handle media references, but you may need to re-upload files

## Alternative: Use Direct Transfer (if enabled)

If data transfer is enabled in cloud Strapi:

```powershell
# Make sure .env has correct cloud URL (without /admin)
npm run strapi transfer
```

Choose: "Push local data to remote Strapi"

## Verify Data Transfer

After import:
1. Login to cloud Strapi admin
2. Check your content types:
   - Fabrics
   - Curtains
   - Blinds
   - Cushions
   - Orders
3. Verify product counts match your local database



