# MantisBT CLI

Small local PowerShell CLI for CRUD access to the local MantisBT REST API.

## First-time setup

1. In MantisBT, create a project and category.
2. Create an API token from the logged-in user account.
3. Run:

```powershell
cd E:\arknet-dev-management\tools
.\mantis.ps1 init
```

Use `http://127.0.0.1:8877` as the base URL unless you changed the local server.

## Commands

```powershell
.\mantis.ps1 create -Project "Project" -Category "General" -Summary "Issue title" -Description "Issue details"
.\mantis.ps1 create-workitem -Project "ArkNet POS" -Type "Task" -Category "Task" -Summary "Issue title" -Description "Issue details" -Sprint "Sprint 1" -StoryPoints 3
.\mantis.ps1 create-bug -Project "ArkNet POS" -Category "POS" -Summary "Bug title" -Description "Actual, expected, repro steps" -DeviceInfo "Z92" -AppVersion "..." -OsVersion "..." -Logs "..."
.\mantis.ps1 list
.\mantis.ps1 get -Id 123
.\mantis.ps1 update -Id 123 -Status "resolved"
.\mantis.ps1 set-sprint -Id 123 -Sprint "Sprint 1"
.\mantis.ps1 set-type -Id 123 -Type "User Story"
.\mantis.ps1 link-parent -Id 123 -ParentId 100
.\mantis.ps1 delete -Id 123
```

Add `-Json` to any command for machine-readable output.

## Project management

Projects are managed through MantisBT and are not hardcoded in the tools.

```powershell
.\mantis.ps1 project-list
.\mantis.ps1 project-add -Name "Project Name" -ProjectDescription "Project purpose"
.\mantis.ps1 project-update -Id 123 -Name "New Project Name"
.\mantis.ps1 project-disable -Id 123
.\mantis.ps1 project-delete -Id 123
```

## Repository registry

Each Mantis project can independently register one or more source repositories.
The registry is stored at `E:\arknet-dev-management\config\repos.json`.

```powershell
.\mantis.ps1 repo-add -Project "ArkNet POS" -RepoName "arknet-pos" -Url "https://github.com/org/repo" -DefaultBranch "main"
.\mantis.ps1 repo-list
.\mantis.ps1 repo-list -Project "ArkNet POS"
.\mantis.ps1 repo-update -Project "ArkNet POS" -RepoName "arknet-pos" -Url "https://github.com/org/new-repo"
.\mantis.ps1 repo-remove -Project "ArkNet POS" -RepoName "arknet-pos"
.\mantis.ps1 source-link -Id 123 -Project "ArkNet POS" -RepoName "arknet-pos" -Commit "abc123"
.\mantis.ps1 evidence-add -Id 123 -Evidence "Verification notes or evidence link" -FilePath "E:\path\log.txt"
```

Do not paste secrets into issue summaries, descriptions, notes, evidence text, or repository URLs.
