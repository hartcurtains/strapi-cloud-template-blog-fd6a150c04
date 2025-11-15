# How to Extract the Backup File

## The Backup File
- **Location:** `backup-unencrypted.tar.gz.tar.gz`
- **Size:** 115 MB
- **Format:** tar.gz (compressed tar archive)

## Extraction Methods

### Method 1: Using 7-Zip (Recommended for Windows)

1. **Download 7-Zip** (if not installed): https://www.7-zip.org/
2. **Right-click** on `backup-unencrypted.tar.gz.tar.gz`
3. **Select:** 7-Zip → Extract Here
4. This will create: `backup-unencrypted.tar.gz.tar`
5. **Right-click** on that file → 7-Zip → Extract Here
6. You'll get a folder with:
   - `entities.jsonl` ← **This is what we need!**
   - `assets/` (folder with images)
   - `schemas.json`
   - `links.jsonl`
   - `configuration.json`

### Method 2: Using WinRAR

1. **Right-click** on `backup-unencrypted.tar.gz.tar.gz`
2. **Select:** Extract Here
3. Repeat for the inner `.tar.gz` file
4. Get the same files as above

### Method 3: Using PowerShell (if tar is available)

```powershell
# Extract outer archive
tar -xzf backup-unencrypted.tar.gz.tar.gz

# Extract inner archive (if needed)
tar -xzf backup-unencrypted.tar.gz.tar
```

## What We Need

After extraction, we need:
- ✅ `entities.jsonl` - All your content (163 KB - small enough for git!)
- ⚠️  `assets/` - Images (109 MB - too large, handle separately)

## Next Step

Once extracted:
1. Copy `entities.jsonl` to: `database/migrations/data/entities.jsonl`
2. Commit to git
3. Push to GitHub
4. Strapi Cloud will deploy and import!

## File Structure After Extraction

```
extracted-backup/
  ├── entities.jsonl          ← Copy this!
  ├── assets/                  ← Too large, skip for now
  ├── schemas.json
  ├── links.jsonl
  └── configuration.json
```

Copy `entities.jsonl` to: `database/migrations/data/entities.jsonl`


