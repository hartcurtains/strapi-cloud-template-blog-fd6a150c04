# Import Fabrics - PowerShell Commands

## PowerShell Command (Recommended)

```powershell
Invoke-WebRequest -Uri "http://localhost:1337/api/fabrics/import" -Method POST -ContentType "application/json" | Select-Object -ExpandProperty Content
```

## Alternative: Using curl.exe (if available)

If you have `curl.exe` installed, you can use:

```powershell
curl.exe -X POST http://localhost:1337/api/fabrics/import
```

## Alternative: Using Invoke-RestMethod (Returns JSON object)

```powershell
Invoke-RestMethod -Uri "http://localhost:1337/api/fabrics/import" -Method POST -ContentType "application/json"
```

## Response Format

The import returns:
```json
{
  "success": true,
  "message": "Fabric import completed",
  "created": 0,      // New fabrics created
  "updated": 121,     // Existing fabrics updated
  "failed": 0,        // Failed imports
  "total": 121,       // Total fabrics processed
  "errors": []        // Array of error messages (if any)
}
```

## Notes

- The import is **idempotent**: running it multiple times will update existing fabrics instead of creating duplicates
- Fabrics are matched by `productId`
- All relations (brands, care instructions) are automatically created/linked



