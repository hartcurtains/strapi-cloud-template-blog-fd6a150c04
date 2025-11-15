# How to Enable Data Transfer on Strapi Cloud

## Method 1: Via Strapi Cloud Dashboard (Recommended)

1. **Go to Strapi Cloud Dashboard:**
   - Visit: https://cloud.strapi.io
   - Login with your account

2. **Select Your Project:**
   - Find and click on: `hartcurtainsandblinds-de382c4a84`
   - Or search for your project name

3. **Navigate to Project Settings:**
   - Click on **"Settings"** in the left sidebar
   - Or go to the **"Configuration"** tab

4. **Enable Data Transfer:**
   - Look for **"Data Transfer"** or **"Remote Transfer"** section
   - Toggle **"Enable Data Transfer"** to ON
   - Or check **"Allow remote data transfer"**
   - Save the settings

5. **Verify:**
   - The setting should now be enabled
   - You may need to wait a few minutes for changes to propagate

## Method 2: Via Strapi Admin Panel

1. **Open Your Cloud Strapi Admin:**
   - Go to: https://celebrated-feast-8b6e91b21c.strapiapp.com/admin
   - Login with admin credentials

2. **Go to Settings:**
   - Click **"Settings"** in the left sidebar
   - Navigate to **"Transfer Tokens"**

3. **Check Transfer Settings:**
   - Look for **"Data Transfer"** or **"Remote Transfer"** options
   - Some versions have this in **"Advanced Settings"**

4. **Enable if Available:**
   - If you see a toggle or checkbox for data transfer, enable it
   - Save changes

## Method 3: Check Server Configuration

The data transfer might be controlled by the `config/server.ts` file. Let's verify it's configured correctly:

```typescript
// config/server.ts should have:
transfer: {
  token: {
    salt: env('TRANSFER_TOKEN_SALT'),
  },
  remote: {
    enabled: true, // This should be true
  },
},
```

## Method 4: Contact Strapi Cloud Support

If you can't find the option:

1. **Check Strapi Cloud Documentation:**
   - Visit: https://docs.strapi.io/cloud/getting-started
   - Look for "Data Transfer" or "Migration" sections

2. **Contact Support:**
   - Go to: https://cloud.strapi.io/support
   - Ask them to enable data transfer for your project
   - Provide your project ID: `hartcurtainsandblinds-de382c4a84`

## Alternative: Use Import/Export Instead

If data transfer can't be enabled, use the import/export method:

1. **Export from Local:**
   ```powershell
   yarn strapi export --file backup.tar.gz
   ```

2. **Import via Cloud Admin:**
   - Go to: https://celebrated-feast-8b6e91b21c.strapiapp.com/admin
   - Settings → Transfer → Import
   - Upload your backup file

## Troubleshooting

**"Data transfer is not enabled" error:**
- Make sure you're using the correct transfer token
- Verify the token hasn't expired
- Check that the URL doesn't include `/admin`
- Wait a few minutes after enabling if you just changed settings

**"Authentication Error":**
- Verify your transfer token is correct
- Make sure the token was created in the CLOUD Strapi admin (not local)
- Check that the token has the right permissions

## Quick Checklist

- [ ] Logged into Strapi Cloud dashboard
- [ ] Found project settings
- [ ] Enabled "Data Transfer" or "Remote Transfer"
- [ ] Saved settings
- [ ] Waited a few minutes for propagation
- [ ] Created a new transfer token in cloud admin
- [ ] Updated `.env` file with new token
- [ ] URL doesn't include `/admin`


