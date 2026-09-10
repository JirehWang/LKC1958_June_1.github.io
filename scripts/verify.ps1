$ErrorActionPreference = "Stop"
Set-Location -LiteralPath "$PSScriptRoot\.."

$javascriptFiles = Get-ChildItem -LiteralPath ".\apps\LKC_WorshipPPT" -Filter "*.js" | Where-Object Name -NotLike "vendor-*" | Sort-Object Name
foreach ($javascriptFile in $javascriptFiles) {
    & node --check $javascriptFile.FullName
    if ($LASTEXITCODE -ne 0) {
        throw "Syntax check failed: $($javascriptFile.Name)"
    }
}

$integrationJavascriptFiles = @(
    ".\apps\LKC_SundayBulletin\js\bulletin-supabase.js",
    ".\scripts\migrate_sunday_bulletin_supabase.js",
    ".\scripts\sync_sunday_bulletin_gas_to_supabase.js"
)
foreach ($javascriptFile in $integrationJavascriptFiles) {
    if (-not (Test-Path -LiteralPath $javascriptFile)) {
        throw "Required integration file is missing: $javascriptFile"
    }
    & node --check (Resolve-Path -LiteralPath $javascriptFile)
    if ($LASTEXITCODE -ne 0) {
        throw "Syntax check failed: $javascriptFile"
    }
}

$testFiles = Get-ChildItem -LiteralPath ".\apps\LKC_WorshipPPT" -Filter "*.test.js" | Sort-Object Name
foreach ($testFile in $testFiles) {
    Write-Host "Running $($testFile.Name)..."
    & node $testFile.FullName
    if ($LASTEXITCODE -ne 0) {
        throw "Test failed: $($testFile.Name)"
    }
}

$integrationTestFiles = @(
    ".\tests\sunday-bulletin-supabase.test.js",
    ".\tests\supabase-migration-security.test.js",
    ".\tests\sunday-bulletin-gas-sync.test.js"
) | Where-Object { Test-Path -LiteralPath $_ }
foreach ($testFile in $integrationTestFiles) {
    Write-Host "Running $testFile..."
    & node (Resolve-Path -LiteralPath $testFile)
    if ($LASTEXITCODE -ne 0) {
        throw "Test failed: $testFile"
    }
}

$rules = Get-Content -Raw -LiteralPath ".\firebase\database.rules.worship-layout.json" | ConvertFrom-Json
if (-not $rules.rules.worshipPpt.layoutConfig.shared) {
    throw "Worship layout RTDB rule is missing."
}
if (-not $rules.rules.worshipPpt.layoutConfig.templates.'$templateId') {
    throw "Template-specific Worship layout RTDB rule is missing."
}

Write-Host "All Worship PPT generator tests passed."
