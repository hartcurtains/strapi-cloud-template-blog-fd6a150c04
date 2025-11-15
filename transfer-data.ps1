# Strapi Transfer Script
# This will push local data to cloud Strapi

Write-Host "Starting Strapi data transfer..."
Write-Host "This will PUSH your local data to cloud Strapi"
Write-Host ""

# Set environment variables
$env:STRAPI_TRANSFER_URL="https://celebrated-feast-8b6e91b21c.strapiapp.com"
$env:STRAPI_TRANSFER_TOKEN="e8357a27626c5b71d0c0ab65494f567502c8810b8e635e338e01c6a5ec5a5d022f6d6dfd7b2a8488a99c7bb3054e2661e519f3ecfb61939163d45d22e3fc27b53ee5fe4b0d5cd8520c86bbda70016f9128ac1f993784b0c8681dbc5b989f4a4b2a8730fc15e6480bd62b3164238632882aca4703d29add96b27d26d4504e98bc"

# Run the transfer command
npm run strapi transfer



