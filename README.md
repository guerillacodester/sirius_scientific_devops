# ArkNet Development Management

Self-contained local development-management stack for ArkNet.

## Layout

```text
E:\arknet-dev-management\
  mantisbt\    MantisBT application
  php\         PHP runtime used by MantisBT
  tools\       Agent CLI for MantisBT issue CRUD
  dashboard\   Local Next.js work board
  scripts\     Start/configuration helpers
  config\      Shared config templates
  docs\        Local documentation
  backups\     Backup output location
```

PostgreSQL remains the existing local PostgreSQL service. MantisBT uses the `mantisbt` database.

## Start

```powershell
E:\arknet-dev-management\scripts\start-mantisbt.ps1
E:\arknet-dev-management\scripts\start-dashboard.ps1
```

MantisBT:

```text
http://127.0.0.1:8877
```

Dashboard:

```text
http://127.0.0.1:8878
```

## Agent CLI

```powershell
cd E:\arknet-dev-management\tools
.\mantis.ps1 list -Json
.\mantis.ps1 create-bug -Project "ArkNet POS" -Category "POS" -Summary "Title" -Description "Details"
.\mantis.ps1 create-workitem -Project "ATCS" -Type "Task" -Category "Task" -Summary "Title" -Description "Details"
.\mantis.ps1 set-sprint -Id 123 -Sprint "Sprint 1"
.\mantis.ps1 set-type -Id 123 -Type "User Story"
.\mantis.ps1 link-parent -Id 123 -ParentId 100
.\mantis.ps1 project-list
.\mantis.ps1 project-add -Name "Project Name" -ProjectDescription "Project purpose"
.\mantis.ps1 repo-add -Project "ArkNet POS" -RepoName "arknet-pos" -Url "https://github.com/org/repo"
```

The CLI reads `tools\mantis.config.json`, which contains the local API token.
Repository mappings are stored in `config\repos.json`.

## Task Updates And Manual Commits

Register a repository for the task's Mantis project with `repo-add`, or use the
dashboard's Repository Registry. Each project can have multiple repositories.
In the dashboard, edit a task and select its repository under Progress And
Commit Draft. Enter a progress update, review or edit the generated commit
message, then select Save Update and Copy Commit Message.

Agents can use the same workflow:

```powershell
.\mantis.ps1 task-update -Id 123 -RepoName "registered-repo" -UpdateText "Describe the code changes made"
```

The task title, ID, and update form the default commit message. Pass
`-CommitMessage "Edited message"` to override it, or `-Json` for structured
output. The repository must be registered for the task's actual project.
The update, repository reference, and draft are saved together in a private
Mantis note. Copy the draft into your Git client and commit manually. This
workflow never stages files, creates commits, or pushes changes.
