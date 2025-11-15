# Import Data to Strapi Cloud via Admin Panel

## Your Export File
- **File:** `strapi-data-backup.tar.gz.tar.gz.enc`
- **Size:** ~110 MB
- **Contains:** 191 entities, 123 assets (images), all relationships

## Method: Import via Strapi Cloud Admin Panel

### Step 1: Access Cloud Admin
1. Go to: https://celebrated-feast-8b6e91b21c.strapiapp.com/admin
2. Login with your admin credentials

### Step 2: Import Data
1. Navigate to: **Settings** → **Transfer** → **Import**
2. Click **"Import"** or **"Choose file"**
3. Select your export file: `strapi-data-backup.tar.gz.tar.gz.enc`
4. Enter the decryption key (the one you used during export)
5. Click **"Import"**

### Step 3: Wait for Import
- The import will take a few minutes (110 MB of data)
- You'll see progress indicators
- Don't close the browser during import

### Step 4: Verify Data
After import completes:
1. Check your content types:
   - Go to **Content Manager**
   - Check **Fabrics** (should have 2 items)
   - Check **Curtains** (should have 2 items)
   - Check **Orders** (should have 17 items)
2. Check media library:
   - Go to **Media Library**
   - Should have 123 images uploaded

## Alternative: Enable Data Transfer in Cloud

If you want to use `strapi transfer` command:

1. Go to Strapi Cloud Dashboard: https://cloud.strapi.io
2. Select your project: `hartcurtainsandblinds-de382c4a84`
3. Go to **Settings** → **Data Transfer**
4. Enable **"Allow data transfer"**
5. Save settings
6. Then run: `npm run strapi transfer`

## Notes
- The import will **replace** existing data in cloud
- Make sure you have a backup if needed
- Media files should be included in the import
- All relationships between content will be preserved



