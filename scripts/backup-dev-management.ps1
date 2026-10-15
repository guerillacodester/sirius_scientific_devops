param(
    [string]$Root = 'E:\arknet-dev-management',
    [string]$PostgresBin = 'D:\Program Files\PostgreSQL\17\bin',
    [string]$Database = 'mantisbt',
    [string]$DbUser = 'mantisbt'
)

$ErrorActionPreference = 'Stop'

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRoot = Join-Path $Root 'backups'
$workRoot = Join-Path $backupRoot "mantis-dev-management-$timestamp"
$archivePath = "$workRoot.zip"

New-Item -ItemType Directory -Path $workRoot -Force | Out-Null

$paths = @(
    'mantisbt\config',
    'tools',
    'dashboard\app',
    'dashboard\package.json',
    'dashboard\package-lock.json',
    'dashboard\next.config.js',
    'dashboard\tsconfig.json',
    'config',
    'scripts',
    'docs',
    'README.md'
)

foreach ($relativePath in $paths) {
    $source = Join-Path $Root $relativePath
    if (-not (Test-Path -LiteralPath $source)) {
        continue
    }

    $destination = Join-Path $workRoot $relativePath
    $destinationParent = Split-Path -Parent $destination
    New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force
}

$pgDump = Join-Path $PostgresBin 'pg_dump.exe'
if (-not (Test-Path -LiteralPath $pgDump -PathType Leaf)) {
    throw "pg_dump.exe was not found at $pgDump"
}

$dumpPath = Join-Path $workRoot 'mantisbt-db.dump'
$configPath = Join-Path $Root 'mantisbt\config\config_inc.php'
$configText = Get-Content -LiteralPath $configPath -Raw
$passwordMatch = [regex]::Match($configText, "\`$g_db_password\s*=\s*'([^']*)'")
if (-not $passwordMatch.Success) {
    throw "Could not read database password from Mantis config."
}

$previousPgPassword = $env:PGPASSWORD
$env:PGPASSWORD = $passwordMatch.Groups[1].Value
& $pgDump @('--format=custom', "--file=$dumpPath", "--username=$DbUser", $Database)
try {
    if ($LASTEXITCODE -ne 0) {
        throw "pg_dump failed with exit code $LASTEXITCODE"
    }
} finally {
    $env:PGPASSWORD = $previousPgPassword
}

Compress-Archive -LiteralPath $workRoot -DestinationPath $archivePath -Force
Remove-Item -LiteralPath $workRoot -Recurse -Force

[pscustomobject]@{
    archive = $archivePath
    database = $Database
    createdAt = (Get-Date).ToString('o')
}
