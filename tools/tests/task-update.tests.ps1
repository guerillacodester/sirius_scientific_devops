$ErrorActionPreference = 'Stop'
$tokens = $null
$parseErrors = $null
$source = Join-Path $PSScriptRoot '..\mantis.ps1'
$ast = [System.Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
$function = $ast.Find({ param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Publish-TaskUpdate'
}, $false)
if (-not $function) { throw 'Publish-TaskUpdate function missing.' }
. ([scriptblock]::Create($function.Extent.Text))

$script:calls = @()
$script:failWrite = $false
function Invoke-Mantis {
    param($Method, $Path, $Body)
    $script:calls += @{ method = $Method; path = $Path; body = $Body }
    if ($Method -eq 'Get') {
        return @{ issues = @(@{ id = 123; summary = "Preserve`ntablet connection"; project = @{ name = 'Tablet' } }) }
    }
    if ($script:failWrite) { throw 'Mock note write failed.' }
    return @{ note = @{ id = 10 } }
}
function Get-RepoRegistry {
    return @{ repositories = @(
        @{ project = 'Tablet'; repoName = 'tablet'; url = 'https://example.test/tablet'; localPath = 'E:\tablet' },
        @{ project = 'POS'; repoName = 'pos'; url = 'https://example.test/pos' }
    ) }
}
function Assert-True($condition, $message) {
    if (-not $condition) { throw $message }
}

$result = Publish-TaskUpdate -TaskId 123 -RepositoryName tablet -Progress 'Keep connection alive.'
Assert-True ($result.commitMessage -ceq "Preserve tablet connection (Mantis #123)`n`nKeep connection alive.") 'Generated draft mismatch.'
Assert-True ($script:calls.Count -eq 2) 'Expected one read and one note write.'
Assert-True ($script:calls[1].method -eq 'Post' -and $script:calls[1].path -eq '/api/rest/issues/123/notes') 'Unexpected write.'
Assert-True ($script:calls[1].body.view_state.name -eq 'private') 'Note must be private.'
Assert-True ($script:calls[1].body.text.Contains('Repository URL: https://example.test/tablet')) 'Repository missing.'
Assert-True ($script:calls[1].body.text.Contains('Local path: E:\tablet')) 'Local path missing.'
$edited = Publish-TaskUpdate -TaskId 123 -RepositoryName tablet -Progress 'Second update.' -MessageDraft "Edited title`n`nEdited body"
Assert-True ($edited.commitMessage -ceq "Edited title`n`nEdited body") 'Edited draft lost.'
foreach ($case in @(
    @{ TaskId = 123; RepositoryName = 'pos'; Progress = 'Update' },
    @{ TaskId = 123; RepositoryName = 'missing'; Progress = 'Update' },
    @{ TaskId = 0; RepositoryName = 'tablet'; Progress = 'Update' },
    @{ TaskId = 123; RepositoryName = ''; Progress = 'Update' },
    @{ TaskId = 123; RepositoryName = 'tablet'; Progress = ' ' }
)) {
    $script:calls = @()
    $failed = $false
    try { Publish-TaskUpdate @case | Out-Null } catch { $failed = $true }
    Assert-True $failed 'Invalid update accepted.'
    Assert-True (@($script:calls | Where-Object { $_.method -ne 'Get' }).Count -eq 0) 'Invalid update wrote to Mantis.'
}
$script:failWrite = $true
$failed = $false
try { Publish-TaskUpdate -TaskId 123 -RepositoryName tablet -Progress 'Update' | Out-Null } catch { $failed = $true }
Assert-True $failed 'Note failure reported success.'
Write-Output 'PASS: CLI parser, generated/edited drafts, private note, repository validation, required input, and write failure (mocked).'
