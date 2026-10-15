param(
    [Parameter(Position = 0, Mandatory = $true)]
    [ValidateSet('init', 'create', 'create-workitem', 'create-bug', 'list', 'get', 'update', 'task-update', 'set-sprint', 'set-type', 'link-parent', 'delete', 'repo-add', 'repo-list', 'repo-update', 'repo-remove', 'source-link', 'evidence-add', 'project-list', 'project-add', 'project-update', 'project-disable', 'project-delete')]
    [string]$Command,

    [string]$Project,
    [string]$Category,
    [string]$Summary,
    [string]$Description,
    [string]$Type,
    [string]$Sprint,
    [int]$StoryPoints,
    [int]$ParentId,
    [string]$DeviceInfo,
    [string]$AppVersion,
    [string]$OsVersion,
    [string]$Logs,
    [string]$Verification,
    [string]$ReleaseReadiness,
    [int]$Id,
    [string]$Status,
    [string]$RepoName,
    [string]$Provider = 'github',
    [string]$Url,
    [string]$DefaultBranch = 'main',
    [string]$LocalPath,
    [string]$Notes,
    [string]$Commit,
    [string]$UpdateText,
    [string]$CommitMessage,
    [string]$Evidence,
    [string]$FilePath,
    [string]$Name,
    [string]$ProjectDescription,
    [string]$ProjectStatus = 'development',
    [string]$ViewState = 'public',
    [string]$RepoConfigPath = 'E:\arknet-dev-management\config\repos.json',
    [string]$ConfigPath = "$PSScriptRoot\mantis.config.json",
    [switch]$Json
)

$ErrorActionPreference = 'Stop'

function Write-Usage {
    @'
Usage:
  .\mantis.ps1 init
  .\mantis.ps1 create -Project "Project" -Category "General" -Summary "Title" -Description "Details"
  .\mantis.ps1 create-workitem -Type "Task" -Category "Task" -Summary "Title" -Description "Details"
  .\mantis.ps1 create-bug -Category "POS" -Summary "Title" -Description "Actual/expected/repro details"
  .\mantis.ps1 list [-Project "Project"]
  .\mantis.ps1 get -Id 123
  .\mantis.ps1 update -Id 123 [-Summary "..."] [-Description "..."] [-Category "..."] [-Status "resolved"]
  .\mantis.ps1 task-update -Id 123 -RepoName "registered-repo" -UpdateText "Changes made" [-CommitMessage "Edited draft"] [-Json]
  .\mantis.ps1 set-sprint -Id 123 -Sprint "Sprint 1"
  .\mantis.ps1 set-type -Id 123 -Type "User Story"
  .\mantis.ps1 link-parent -Id 123 -ParentId 100
  .\mantis.ps1 delete -Id 123
  .\mantis.ps1 repo-add -Project "ArkNet POS" -RepoName "arknet-pos" -Url "https://github.com/org/repo"
  .\mantis.ps1 repo-list
  .\mantis.ps1 repo-update -Project "ArkNet POS" -RepoName "arknet-pos" -Url "https://github.com/org/new-repo"
  .\mantis.ps1 repo-remove -Project "ArkNet POS" -RepoName "arknet-pos"
  .\mantis.ps1 source-link -Id 123 -Project "ArkNet POS" -RepoName "arknet-pos" -Commit "abc123" [-Url "https://github.com/org/repo/commit/abc123"]
  .\mantis.ps1 evidence-add -Id 123 -Evidence "Verification notes or evidence link" [-FilePath "E:\path\log.txt"]
  .\mantis.ps1 project-list
  .\mantis.ps1 project-add -Name "Project Name" -ProjectDescription "Purpose"
  .\mantis.ps1 project-update -Id 123 -Name "New Name"
  .\mantis.ps1 project-disable -Id 123
  .\mantis.ps1 project-delete -Id 123

Configuration:
  Create a MantisBT API token in MantisBT, then run init.
'@
}

function Get-RepoRegistry {
    if (-not (Test-Path -LiteralPath $RepoConfigPath)) {
        $dir = Split-Path -Parent $RepoConfigPath
        if (-not (Test-Path -LiteralPath $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
        }
        [pscustomobject]@{ repositories = @() } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $RepoConfigPath -Encoding UTF8
    }

    $registry = Get-Content -LiteralPath $RepoConfigPath -Raw | ConvertFrom-Json
    if ($null -eq $registry.repositories) {
        $registry | Add-Member -NotePropertyName repositories -NotePropertyValue @()
    }
    return $registry
}

function Save-RepoRegistry {
    param([object]$Registry)

    $Registry | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $RepoConfigPath -Encoding UTF8
}

function Test-RepoInput {
    if ([string]::IsNullOrWhiteSpace($Project)) {
        throw "Repository commands require -Project."
    }
    if ([string]::IsNullOrWhiteSpace($RepoName)) {
        throw "Repository commands require -RepoName."
    }
}

function Read-SecretPlainText {
    param([string]$Prompt)

    $secure = Read-Host -Prompt $Prompt -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
}

function Get-Config {
    if (-not (Test-Path -LiteralPath $ConfigPath)) {
        throw "Config file not found: $ConfigPath. Run: .\mantis.ps1 init"
    }

    Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
}

function Invoke-Mantis {
    param(
        [Parameter(Mandatory = $true)][string]$Method,
        [Parameter(Mandatory = $true)][string]$Path,
        [object]$Body = $null
    )

    $config = Get-Config
    $baseUrl = [string]$config.baseUrl
    $token = [string]$config.apiToken
    if ([string]::IsNullOrWhiteSpace($baseUrl) -or [string]::IsNullOrWhiteSpace($token)) {
        throw "Config must contain baseUrl and apiToken."
    }

    $uri = $baseUrl.TrimEnd('/') + $Path
    $headers = @{ Authorization = $token }
    $params = @{
        Method = $Method
        Uri = $uri
        Headers = $headers
        ContentType = 'application/json'
    }

    if ($null -ne $Body) {
        $params.Body = ($Body | ConvertTo-Json -Depth 12)
    }

    Invoke-RestMethod @params
}

function Resolve-ProjectRef {
    param([string]$Name)

    if ([string]::IsNullOrWhiteSpace($Name)) {
        $config = Get-Config
        $Name = [string]$config.defaultProject
    }

    if ([string]::IsNullOrWhiteSpace($Name)) {
        throw "Project is required. Pass -Project or set defaultProject in config."
    }

    @{ name = $Name }
}

function Add-CustomField {
    param(
        [array]$Fields,
        [string]$Name,
        [object]$Value
    )

    if ($null -eq $Value) {
        return $Fields
    }

    if ($Value -is [string] -and [string]::IsNullOrWhiteSpace($Value)) {
        return $Fields
    }

    if ($Value -is [int] -and $Value -le 0) {
        return $Fields
    }

    $Fields += @{
        field = @{ name = $Name }
        value = [string]$Value
    }

    return $Fields
}

function New-CustomFields {
    param(
        [string]$WorkItemType,
        [string]$SprintValue,
        [int]$StoryPointsValue,
        [int]$ParentIssueId,
        [string]$DeviceInformation,
        [string]$ApplicationVersion,
        [string]$OperatingSystemVersion,
        [string]$RelevantLogs,
        [string]$VerificationResult,
        [string]$ReleaseReadinessValue
    )

    $fields = @()
    $fields = Add-CustomField -Fields $fields -Name 'Work Item Type' -Value $WorkItemType
    $fields = Add-CustomField -Fields $fields -Name 'Sprint' -Value $SprintValue
    $fields = Add-CustomField -Fields $fields -Name 'Story Points' -Value $StoryPointsValue
    $fields = Add-CustomField -Fields $fields -Name 'Parent Issue' -Value $ParentIssueId
    $fields = Add-CustomField -Fields $fields -Name 'Device Information' -Value $DeviceInformation
    $fields = Add-CustomField -Fields $fields -Name 'Application Version' -Value $ApplicationVersion
    $fields = Add-CustomField -Fields $fields -Name 'Operating System Version' -Value $OperatingSystemVersion
    $fields = Add-CustomField -Fields $fields -Name 'Relevant Logs' -Value $RelevantLogs
    $fields = Add-CustomField -Fields $fields -Name 'Verification Result' -Value $VerificationResult
    $fields = Add-CustomField -Fields $fields -Name 'Release Readiness' -Value $ReleaseReadinessValue
    return $fields
}

function Add-CustomFieldsToBody {
    param(
        [hashtable]$Body,
        [array]$Fields
    )

    if ($Fields.Count -gt 0) {
        $Body.custom_fields = $Fields
    }

    return $Body
}

function Show-Result {
    param([object]$Value)

    if ($Json) {
        $Value | ConvertTo-Json -Depth 12
        return
    }

    $Value
}

function New-ProjectPayload {
    param(
        [string]$ProjectName,
        [string]$Description,
        [string]$Status,
        [string]$Visibility,
        [bool]$Enabled = $true,
        [switch]$Partial
    )

    $body = @{}
    if (-not [string]::IsNullOrWhiteSpace($ProjectName)) { $body.name = $ProjectName }
    if (-not [string]::IsNullOrWhiteSpace($Description)) { $body.description = $Description }
    if (-not [string]::IsNullOrWhiteSpace($Status)) { $body.status = @{ name = $Status } }
    if (-not [string]::IsNullOrWhiteSpace($Visibility)) { $body.view_state = @{ name = $Visibility } }
    if (-not $Partial) {
        $body.enabled = $Enabled
        $body.inherit_global = $true
    }
    return $body
}

function Publish-TaskUpdate {
    param([int]$TaskId, [string]$RepositoryName, [string]$Progress, [string]$MessageDraft)

    if ($TaskId -le 0 -or [string]::IsNullOrWhiteSpace($RepositoryName) -or [string]::IsNullOrWhiteSpace($Progress)) {
        throw 'Task-update requires -Id, -RepoName, and -UpdateText.'
    }
    $data = Invoke-Mantis -Method Get -Path "/api/rest/issues/$TaskId"
    $task = @($data.issues | Where-Object { $_.id -eq $TaskId })
    if ($task.Count -ne 1) { throw "Task not found: $TaskId" }
    $registry = Get-RepoRegistry
    $repository = @($registry.repositories | Where-Object {
        $_.project -ceq $task[0].project.name -and $_.repoName -ceq $RepositoryName
    })
    if ($repository.Count -ne 1) { throw 'Repository is not registered for this task project.' }
    if ([string]::IsNullOrWhiteSpace($MessageDraft)) {
        $title = ($task[0].summary -replace '[\r\n]+', ' ').Trim()
        $MessageDraft = "$title (Mantis #$TaskId)`n`n$($Progress.Trim())"
    }
    $MessageDraft = $MessageDraft.Trim()
    $lines = @(
        "Task update (Mantis #$TaskId)"
        $Progress.Trim()
        ''
        "Repository: $($repository[0].repoName)"
        "Repository URL: $($repository[0].url)"
    )
    if (-not [string]::IsNullOrWhiteSpace($repository[0].localPath)) {
        $lines += "Local path: $($repository[0].localPath)"
    }
    $lines += @('', 'Commit message draft (manual commit):', $MessageDraft)
    $note = Invoke-Mantis -Method Post -Path "/api/rest/issues/$TaskId/notes" -Body @{
        text = ($lines -join "`n")
        view_state = @{ name = 'private' }
    }
    return [pscustomobject]@{ taskId = $TaskId; repository = $repository[0]; commitMessage = $MessageDraft; note = $note }
}

switch ($Command) {
    'task-update' {
        if ($PSBoundParameters.ContainsKey('CommitMessage') -and [string]::IsNullOrWhiteSpace($CommitMessage)) {
            throw 'Commit message must not be empty.'
        }
        $result = Publish-TaskUpdate -TaskId $Id -RepositoryName $RepoName -Progress $UpdateText -MessageDraft $CommitMessage
        if ($Json) { Show-Result $result } else { Write-Output $result.commitMessage }
    }
    'init' {
        $baseUrl = Read-Host -Prompt 'MantisBT base URL' 
        if ([string]::IsNullOrWhiteSpace($baseUrl)) {
            $baseUrl = 'http://127.0.0.1:8877'
        }

        $apiToken = Read-SecretPlainText -Prompt 'MantisBT API token'
        $defaultProject = Read-Host -Prompt 'Default project name'

        [pscustomobject]@{
            baseUrl = $baseUrl.TrimEnd('/')
            apiToken = $apiToken
            defaultProject = $defaultProject
        } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $ConfigPath -Encoding UTF8

        Write-Host "Wrote $ConfigPath"
    }

    'create' {
        if ([string]::IsNullOrWhiteSpace($Category) -or [string]::IsNullOrWhiteSpace($Summary) -or [string]::IsNullOrWhiteSpace($Description)) {
            Write-Usage
            throw "Create requires -Category, -Summary, and -Description."
        }

        $body = @{
            summary = $Summary
            description = $Description
            project = Resolve-ProjectRef -Name $Project
            category = @{ name = $Category }
        }
        $fields = New-CustomFields -WorkItemType $Type -SprintValue $Sprint -StoryPointsValue $StoryPoints -ParentIssueId $ParentId -DeviceInformation $DeviceInfo -ApplicationVersion $AppVersion -OperatingSystemVersion $OsVersion -RelevantLogs $Logs -VerificationResult $Verification -ReleaseReadinessValue $ReleaseReadiness
        $body = Add-CustomFieldsToBody -Body $body -Fields $fields

        Show-Result (Invoke-Mantis -Method Post -Path '/api/rest/issues' -Body $body)
    }

    'create-workitem' {
        if ([string]::IsNullOrWhiteSpace($Type) -or [string]::IsNullOrWhiteSpace($Category) -or [string]::IsNullOrWhiteSpace($Summary) -or [string]::IsNullOrWhiteSpace($Description)) {
            Write-Usage
            throw "Create-workitem requires -Type, -Category, -Summary, and -Description."
        }

        $body = @{
            summary = $Summary
            description = $Description
            project = Resolve-ProjectRef -Name $Project
            category = @{ name = $Category }
        }
        $fields = New-CustomFields -WorkItemType $Type -SprintValue $Sprint -StoryPointsValue $StoryPoints -ParentIssueId $ParentId -DeviceInformation $DeviceInfo -ApplicationVersion $AppVersion -OperatingSystemVersion $OsVersion -RelevantLogs $Logs -VerificationResult $Verification -ReleaseReadinessValue $ReleaseReadiness
        $body = Add-CustomFieldsToBody -Body $body -Fields $fields

        Show-Result (Invoke-Mantis -Method Post -Path '/api/rest/issues' -Body $body)
    }

    'create-bug' {
        if ([string]::IsNullOrWhiteSpace($Category) -or [string]::IsNullOrWhiteSpace($Summary) -or [string]::IsNullOrWhiteSpace($Description)) {
            Write-Usage
            throw "Create-bug requires -Category, -Summary, and -Description."
        }

        $body = @{
            summary = $Summary
            description = $Description
            project = Resolve-ProjectRef -Name $Project
            category = @{ name = $Category }
        }
        $fields = New-CustomFields -WorkItemType 'Bug' -SprintValue $Sprint -StoryPointsValue $StoryPoints -ParentIssueId $ParentId -DeviceInformation $DeviceInfo -ApplicationVersion $AppVersion -OperatingSystemVersion $OsVersion -RelevantLogs $Logs -VerificationResult $Verification -ReleaseReadinessValue $ReleaseReadiness
        $body = Add-CustomFieldsToBody -Body $body -Fields $fields

        Show-Result (Invoke-Mantis -Method Post -Path '/api/rest/issues' -Body $body)
    }

    'list' {
        $path = '/api/rest/issues?page_size=50'
        if (-not [string]::IsNullOrWhiteSpace($Project)) {
            $projects = Invoke-Mantis -Method Get -Path '/api/rest/projects'
            $match = $projects.projects | Where-Object { $_.name -eq $Project } | Select-Object -First 1
            if ($null -eq $match) {
                throw "Project not found: $Project"
            }
            $path += "&project_id=$($match.id)"
        }

        Show-Result (Invoke-Mantis -Method Get -Path $path)
    }

    'get' {
        if ($Id -le 0) {
            throw "Get requires -Id."
        }

        Show-Result (Invoke-Mantis -Method Get -Path "/api/rest/issues/$Id")
    }

    'update' {
        if ($Id -le 0) {
            throw "Update requires -Id."
        }

        $body = @{}
        if (-not [string]::IsNullOrWhiteSpace($Summary)) { $body.summary = $Summary }
        if (-not [string]::IsNullOrWhiteSpace($Description)) { $body.description = $Description }
        if (-not [string]::IsNullOrWhiteSpace($Category)) { $body.category = @{ name = $Category } }
        if (-not [string]::IsNullOrWhiteSpace($Status)) { $body.status = @{ name = $Status } }
        $fields = New-CustomFields -WorkItemType $Type -SprintValue $Sprint -StoryPointsValue $StoryPoints -ParentIssueId $ParentId -DeviceInformation $DeviceInfo -ApplicationVersion $AppVersion -OperatingSystemVersion $OsVersion -RelevantLogs $Logs -VerificationResult $Verification -ReleaseReadinessValue $ReleaseReadiness
        $body = Add-CustomFieldsToBody -Body $body -Fields $fields
        if ($body.Count -eq 0) {
            throw "Update needs at least one field."
        }

        Show-Result (Invoke-Mantis -Method Patch -Path "/api/rest/issues/$Id" -Body $body)
    }

    'set-sprint' {
        if ($Id -le 0 -or [string]::IsNullOrWhiteSpace($Sprint)) {
            throw "Set-sprint requires -Id and -Sprint."
        }
        $body = Add-CustomFieldsToBody -Body @{} -Fields (New-CustomFields -SprintValue $Sprint)
        Show-Result (Invoke-Mantis -Method Patch -Path "/api/rest/issues/$Id" -Body $body)
    }

    'set-type' {
        if ($Id -le 0 -or [string]::IsNullOrWhiteSpace($Type)) {
            throw "Set-type requires -Id and -Type."
        }
        $body = Add-CustomFieldsToBody -Body @{} -Fields (New-CustomFields -WorkItemType $Type)
        Show-Result (Invoke-Mantis -Method Patch -Path "/api/rest/issues/$Id" -Body $body)
    }

    'link-parent' {
        if ($Id -le 0 -or $ParentId -le 0) {
            throw "Link-parent requires -Id and -ParentId."
        }
        $body = Add-CustomFieldsToBody -Body @{} -Fields (New-CustomFields -ParentIssueId $ParentId)
        Show-Result (Invoke-Mantis -Method Patch -Path "/api/rest/issues/$Id" -Body $body)
    }

    'delete' {
        if ($Id -le 0) {
            throw "Delete requires -Id."
        }

        Show-Result (Invoke-Mantis -Method Delete -Path "/api/rest/issues/$Id")
    }

    'repo-add' {
        Test-RepoInput
        if ([string]::IsNullOrWhiteSpace($Url)) {
            throw "Repo-add requires -Url."
        }

        $registry = Get-RepoRegistry
        $existing = @($registry.repositories | Where-Object { $_.project -eq $Project -and $_.repoName -eq $RepoName })
        if ($existing.Count -gt 0) {
            throw "Repository already exists for project '$Project' with name '$RepoName'. Use repo-update."
        }

        $entry = [pscustomobject]@{
            project = $Project
            repoName = $RepoName
            provider = $Provider
            url = $Url
            defaultBranch = $DefaultBranch
            localPath = $LocalPath
            notes = $Notes
        }
        $registry.repositories = @($registry.repositories) + $entry
        Save-RepoRegistry -Registry $registry
        Show-Result $entry
    }

    'repo-list' {
        $registry = Get-RepoRegistry
        $items = @($registry.repositories)
        if (-not [string]::IsNullOrWhiteSpace($Project)) {
            $items = @($items | Where-Object { $_.project -eq $Project })
        }
        Show-Result ([pscustomobject]@{ repositories = $items })
    }

    'repo-update' {
        Test-RepoInput
        $registry = Get-RepoRegistry
        $items = @($registry.repositories)
        $match = $items | Where-Object { $_.project -eq $Project -and $_.repoName -eq $RepoName } | Select-Object -First 1
        if ($null -eq $match) {
            throw "Repository not found for project '$Project' with name '$RepoName'."
        }

        if (-not [string]::IsNullOrWhiteSpace($Provider)) { $match.provider = $Provider }
        if (-not [string]::IsNullOrWhiteSpace($Url)) { $match.url = $Url }
        if (-not [string]::IsNullOrWhiteSpace($DefaultBranch)) { $match.defaultBranch = $DefaultBranch }
        if ($PSBoundParameters.ContainsKey('LocalPath')) { $match.localPath = $LocalPath }
        if ($PSBoundParameters.ContainsKey('Notes')) { $match.notes = $Notes }
        $registry.repositories = $items
        Save-RepoRegistry -Registry $registry
        Show-Result $match
    }

    'repo-remove' {
        Test-RepoInput
        $registry = Get-RepoRegistry
        $before = @($registry.repositories)
        $after = @($before | Where-Object { -not ($_.project -eq $Project -and $_.repoName -eq $RepoName) })
        if ($after.Count -eq $before.Count) {
            throw "Repository not found for project '$Project' with name '$RepoName'."
        }

        $registry.repositories = $after
        Save-RepoRegistry -Registry $registry
        Show-Result ([pscustomobject]@{ removed = @{ project = $Project; repoName = $RepoName } })
    }

    'source-link' {
        if ($Id -le 0) {
            throw "Source-link requires -Id."
        }
        Test-RepoInput
        if ([string]::IsNullOrWhiteSpace($Commit)) {
            throw "Source-link requires -Commit."
        }

        $registry = Get-RepoRegistry
        $repo = @($registry.repositories | Where-Object { $_.project -eq $Project -and $_.repoName -eq $RepoName } | Select-Object -First 1)
        if ($repo.Count -eq 0) {
            throw "Repository not found for project '$Project' with name '$RepoName'."
        }

        $commitRef = $Commit.Trim()
        $commitUrl = $Url
        if ([string]::IsNullOrWhiteSpace($commitUrl) -and -not [string]::IsNullOrWhiteSpace([string]$repo[0].url)) {
            $base = ([string]$repo[0].url).TrimEnd('/')
            if ($base.EndsWith('.git')) {
                $base = $base.Substring(0, $base.Length - 4)
            }
            $commitUrl = "$base/commit/$commitRef"
        }

        $lines = @(
            'Source reference recorded by Mantis CLI.'
            "Project: $Project"
            "Repository: $RepoName"
            "Provider: $($repo[0].provider)"
            "Default branch: $($repo[0].defaultBranch)"
            "Commit: $commitRef"
        )
        if (-not [string]::IsNullOrWhiteSpace($commitUrl)) {
            $lines += "Commit URL: $commitUrl"
        }
        if (-not [string]::IsNullOrWhiteSpace($Notes)) {
            $lines += "Notes: $Notes"
        }

        $body = @{
            text = ($lines -join "`n")
            view_state = @{ name = 'public' }
        }
        Show-Result (Invoke-Mantis -Method Post -Path "/api/rest/issues/$Id/notes" -Body $body)
    }

    'evidence-add' {
        if ($Id -le 0) {
            throw "Evidence-add requires -Id."
        }
        if ([string]::IsNullOrWhiteSpace($Evidence) -and [string]::IsNullOrWhiteSpace($FilePath)) {
            throw "Evidence-add requires -Evidence or -FilePath."
        }

        $lines = @('Verification evidence recorded by Mantis CLI.')
        if (-not [string]::IsNullOrWhiteSpace($Evidence)) {
            $lines += $Evidence.Trim()
        }

        $body = @{
            text = ($lines -join "`n")
            view_state = @{ name = 'public' }
        }

        if (-not [string]::IsNullOrWhiteSpace($FilePath)) {
            if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
                throw "Evidence file not found: $FilePath"
            }
            $fileName = Split-Path -Leaf $FilePath
            $content = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $FilePath)))
            $body.files = @(
                @{
                    name = $fileName
                    content = $content
                }
            )
        }

        Show-Result (Invoke-Mantis -Method Post -Path "/api/rest/issues/$Id/notes" -Body $body)
    }

    'project-list' {
        Show-Result (Invoke-Mantis -Method Get -Path '/api/rest/projects')
    }

    'project-add' {
        if ([string]::IsNullOrWhiteSpace($Name)) {
            throw "Project-add requires -Name."
        }
        $body = New-ProjectPayload -ProjectName $Name -Description $ProjectDescription -Status $ProjectStatus -Visibility $ViewState
        Show-Result (Invoke-Mantis -Method Post -Path '/api/rest/projects' -Body $body)
    }

    'project-update' {
        if ($Id -le 0) {
            throw "Project-update requires -Id."
        }
        $body = New-ProjectPayload -ProjectName $Name -Description $ProjectDescription -Status $ProjectStatus -Visibility $ViewState -Partial
        if ($body.Count -eq 0) {
            throw "Project-update needs at least one field."
        }
        Show-Result (Invoke-Mantis -Method Patch -Path "/api/rest/projects/$Id" -Body $body)
    }

    'project-disable' {
        if ($Id -le 0) {
            throw "Project-disable requires -Id."
        }
        Show-Result (Invoke-Mantis -Method Patch -Path "/api/rest/projects/$Id" -Body @{ enabled = $false })
    }

    'project-delete' {
        if ($Id -le 0) {
            throw "Project-delete requires -Id."
        }
        Show-Result (Invoke-Mantis -Method Delete -Path "/api/rest/projects/$Id")
    }
}
