param(
  [string]$InputFolder,
  [string]$OutputFolder,
  [int]$Concurrency = 2
)

if (-not $InputFolder) { $InputFolder = Read-Host 'Source folder containing Ashley Wilde originals' }
if (-not $OutputFolder) { $OutputFolder = Read-Host 'Separate output folder for upload-ready images' }

node (Join-Path $PSScriptRoot 'prepare-ashley-wilde-images.mjs') `
  --input $InputFolder `
  --output $OutputFolder `
  --concurrency $Concurrency
$exitCode = $LASTEXITCODE

Read-Host 'Preparation finished. Press Enter to close'
exit $exitCode
