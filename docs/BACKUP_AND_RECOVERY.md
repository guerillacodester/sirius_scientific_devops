# Backup And Recovery

Backup output belongs in `E:\arknet-dev-management\backups`.

Run `scripts\backup-dev-management.ps1` from the dev-management root to create a timestamped archive. The archive includes:

- MantisBT local config
- Mantis CLI tools and local config
- Dashboard source and package manifests
- Shared config, including repository mappings
- Startup/configuration scripts
- Documentation
- A PostgreSQL custom-format dump of the `mantisbt` database

Secrets are not printed by the backup script. They are preserved inside the local backup archive because a working restore needs the local Mantis/database/API configuration.

Restore outline:

1. Stop the local MantisBT and dashboard processes.
2. Extract the backup archive to a staging folder.
3. Restore the PostgreSQL dump into the `mantisbt` database with `pg_restore`.
4. Copy the extracted config, tools, dashboard, scripts, docs, and README content back under `E:\arknet-dev-management`.
5. Start MantisBT and the dashboard.
6. Verify Mantis web access, CLI project listing, dashboard `/api/projects`, and dashboard `/api/issues`.

Do not restore over a newer working setup without first taking a fresh backup.
