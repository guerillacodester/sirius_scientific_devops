# Agent Operating Procedure

MantisBT is the source of truth for this dev-management work. Agents should update the matching Mantis issue whenever a step is completed, tested, blocked, or found unverified.

## Read Current State

Use the local CLI from `E:\arknet-dev-management\tools`.

1. List projects with `project-list`.
2. List issues with `list`, optionally scoped by project.
3. Read a specific issue with `get -Id <issue id>`.
4. Read repository mappings with `repo-list`.

## Create Work

Use `create-workitem` for planned work and `create-bug` for defects.

Required fields:

- Project
- Category
- Summary
- Description
- Work item type

Expected work item types:

- Epic
- Feature
- User Story
- Task
- Bug
- Improvement
- Technical Debt

Recommended fields:

- Sprint
- Story Points
- Parent Issue
- Verification Result
- Release Readiness
- Device Information
- Application Version
- Operating System Version
- Relevant Logs

## Update Work

Use `update` for summary, description, category, status, verification, release readiness, logs, and other custom fields.

Allowed workflow statuses:

- new
- assigned
- in_progress
- code_review
- testing
- resolved
- closed

Use `link-parent` when the issue belongs under an epic, feature, roadmap phase, or other parent work item.

## Source References

Use `repo-add`, `repo-update`, and `repo-remove` to maintain project repository mappings. Use `source-link` to record a commit reference against an issue.

Source references should include issue id, project, repo name, commit hash, and optional notes. Do not include repository credentials or private tokens in URLs.

## Evidence

Use `evidence-add` for test notes, screenshots, logs, or links to external evidence. The command can attach a local file.

Before adding evidence:

- Remove credentials, API tokens, passwords, private keys, passenger data, payment data, and sensitive location data.
- Prefer short evidence notes that explain what was verified and what remains unverified.
- Use `Verification Result` to record Passed, Failed, Blocked, Unverified, or Not Required.
- Use `Relevant Logs` only for sanitized excerpts or references.

## Phase Tracking

Each roadmap phase has its own Mantis issue. A phase can move to resolved only when its required checks have passed and the issue description records:

- Completed substeps
- Checks run
- Result of each check
- Temporary validation records created and cleaned up
- Remaining unverified items

Do not move to the next phase until the current phase issue is updated.
