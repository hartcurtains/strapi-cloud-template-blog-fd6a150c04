# Import Data via Git - Step by Step Guide

## The Idea

Instead of using CLI or admin panel, we can:
1. Extract the backup data
2. Commit the data files to git (in a structured way)
3. Create a migration script that imports on deployment
4. Push to GitHub → Strapi Cloud auto-deploys → Migration runs → Data imported!

## Step 1: Extract the Backup

```powershell
# Extract the unencrypted backup
# Use 7-Zip, WinRAR, or tar command
# Extract: backup-unencrypted.tar.gz.tar.gz
# This will create files like:
#   - entities.jsonl
#   - assets/ (folder with images)
#   - schemas.json
#   - links.jsonl
#   - configuration.json
```

## Step 2: Prepare Data for Git

We need to:
1. Put data files in a git-friendly location
2. Keep file sizes manageable (GitHub has 100MB limit)
3. Structure it so migration can find it

**Option A: Put essential data only:**
- `entities.jsonl` (163 KB - small enough)
- Skip `assets/` folder (too large, upload separately)

**Option B: Use Git LFS for large files:**
- Install Git LFS
- Track large files with LFS
- Commit everything

## Step 3: Create Migration Script

I've created: `database/migrations/import-local-data.js`

This script:
- Runs automatically on Strapi Cloud deployment
- Reads `database/migrations/data/entities.jsonl`
- Imports all entities using Strapi's entity service
- Handles relationships and dependencies

## Step 4: Structure the Data

```
hcbDBWIP/
  database/
    migrations/
      data/
        entities.jsonl    ← Your extracted entities
        (assets can be uploaded separately via admin)
```

## Step 5: Commit and Push

```powershell
# Add data files
git add database/migrations/data/entities.jsonl
git add database/migrations/import-local-data.js

# Commit
git commit -m "Add data import migration"

# Push
git push origin main
```

## Step 6: Strapi Cloud Deploys

- Strapi Cloud detects the push
- Runs `npm run build`
- Runs migrations (including our import script)
- Data gets imported automatically!

## Important Considerations

### File Size Limits
- GitHub: 100 MB per file limit
- `entities.jsonl`: ~163 KB ✅ (small enough)
- `assets/`: 109 MB ❌ (too large for git)

### Solution for Assets
1. **Upload assets separately** via Strapi admin panel after data import
2. **Use Git LFS** for assets folder
3. **Or** upload assets via API after entities are imported

### Migration Timing
- Migration runs on **every deployment**
- Need to add check: "Has data already been imported?"
- Or make it idempotent (can run multiple times safely)

## Next Steps

1. **Extract the backup:**
   ```powershell
   # Extract backup-unencrypted.tar.gz.tar.gz
   # Get entities.jsonl file
   ```

2. **Create data directory:**
   ```powershell
   mkdir database\migrations\data
   # Copy entities.jsonl there
   ```

3. **Update migration script** (I'll help with this)

4. **Commit and push**

5. **Watch Strapi Cloud deploy and import!**

## Pros and Cons

**Pros:**
- ✅ Automatic on deployment
- ✅ Version controlled
- ✅ No manual steps needed
- ✅ Works with Strapi Cloud's deployment process

**Cons:**
- ⚠️  Assets too large for git (need separate solution)
- ⚠️  Migration runs every deploy (need idempotency check)
- ⚠️  Need to structure data correctly

## Let's Do This!

Want me to help you:
1. Extract the backup?
2. Set up the data structure?
3. Update the migration script?
4. Commit and push?

This could actually work! 🚀


