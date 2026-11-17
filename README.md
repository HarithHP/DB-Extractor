# HHP Database Extractor

Single-user, local-first app that extracts database **schema** (and optionally **table data**) into a timestamped folder tree on your disk. Credentials live in an encrypted vault unlocked only by your master password.

> **Personal use only.** Do not store credentials for systems you do not own. A forgotten master password cannot be recovered.

Full product specification: [`docs/PROJECT.md`](docs/PROJECT.md).

---

## Features

- Encrypted local vault (PBKDF2 + AES-GCM); no cloud sync
- Projects for SQLite, PostgreSQL, MySQL/MariaDB, SQL Server (live); other engines can be saved for later
- Connection test with staged diagnostics
- Extraction modes:
  - **Schema only** — tables, views, keys, procedures, triggers, …
  - **Full backup (SQL)** — schema + all user-table rows as portable `INSERT` scripts
  - **Native backup** — SQLite `.db` copy, or `pg_dump` / `mysqldump` when on PATH (SQL fallback otherwise)
- Immutable snapshots under `exports/…` with `manifest.json` and optional ZIP download
- **Windows desktop app** (Electron): Setup.exe, system tray, Start with Windows, port 9000

---

## Quick start (browser)

```bash
npm install
npm run dev          # http://127.0.0.1:9000
```

Other scripts:

```bash
npm run build && npm start   # production on 127.0.0.1:9000
npm test
npm run typecheck
```

Use **Chrome / Edge / Brave** and pick a folder such as `C:\HHP` (not the drive root `C:\`). On browsers without the File System Access API, storage falls back to OPFS/IndexedDB and snapshots can be downloaded as ZIP.

---

## Windows desktop app

Same UI and DB bridge, packaged with Electron.

| Command | Purpose |
| --- | --- |
| `npm run desktop:dev` | Next + Electron for development |
| `npm run desktop:build` | Build `release/HHP Database Extractor Setup <version>.exe` |

After install:

- Starts with Windows (hidden to **system tray**)
- Double-click tray icon → Open
- Tray **Quit** fully exits (closing the window only hides)
- Storage uses the Node filesystem bridge (no browser permission prompts)

### Updating the desktop app

No in-app auto-update. Bump `"version"` in `package.json` → `npm run desktop:build` → install the new Setup.exe.

---

## Status

| Area | State |
| --- | --- |
| Local auth, encrypted vault | Done |
| Projects CRUD | Done |
| SQLite schema + data / native `.db` | Done |
| Postgres / MySQL / MariaDB / MSSQL (test + schema + SQL data dump) | Done |
| Full backup modes (schema / full SQL / native) | Done |
| Extraction wizard, manifest, history, ZIP | Done |
| Windows desktop (Electron + Setup.exe + tray + startup) | Done |
| Oracle / MongoDB / Redis / Cassandra drivers | Saved as projects only; extract later |
| Idle auto-lock, change password, wipe vault | Milestone 6 |
| PWA / Capacitor / mobile | Later |

---

## How remote databases work

Browsers cannot open raw TCP to databases. This app runs a **local Next.js bridge** on `127.0.0.1:9000` (`app/api/bridge/[engine]/[action]`) using Node drivers (`pg`, `mysql2`, `tedious`).

- Credentials are decrypted in the client and sent per request; the bridge does not store them
- Only localhost `Host` / `Origin` are accepted
- Sessions are read-oriented (schema + `SELECT` for data dumps)

SQLite uses in-process `sql.js` (no bridge).

---

## Storage layout

```
<root>/                          e.g. C:\HHP
  config/user.json               username, salt, KDF, verifier, wrapped DEK
  config/meta.json               app + schema version
  config/settings.json           preferences (default extract options)
  vault/projects.enc             encrypted project list
  vault/<projectId>/conn.enc     encrypted connection credentials
  exports/<project>/<database>/<YYYY-MM-DD>/<YYYY-MM-DDTHH-mm-ssZ>/
    manifest.json
    01_tables.sql … 15_….sql
    20_data.sql                  (full / native SQL data modes)
    objects/<category>/…
    native/…                     (native dump / SQLite .db when produced)
    _partial                     (present if a run failed mid-write)
  logs/<YYYY-MM-DD>.log          optional; secrets redacted
```

---

## Security (short)

| | |
| --- | --- |
| Master key | PBKDF2-SHA256, 600k iterations, random salt |
| DEK | 256-bit AES-GCM, wrapped by master key; memory only while unlocked |
| Vault files | JWT (HS256) inside AES-GCM envelope |
| Logging | Passwords / connection strings redacted |

**Protects against:** casual file access, stolen `vault\` copy.  
**Does not protect against:** malware with process memory access, keyloggers, malicious extensions.

---

## Implementation notes (vs `docs/PROJECT.md`)

1. Local Next.js server is the DB bridge (not a separate sidecar).
2. Windows packaging is **Electron + NSIS**; desktop writes use `electron-fs` IPC.
3. Full backup (structure + data) is intentional: offline export, not a data browser.
4. First-run order: `/setup` (pick folder) → `/onboarding` or `/login`.
5. Snapshot folders use UTC `YYYY-MM-DDTHH-mm-ssZ`; partial runs keep a `_partial` marker.
6. Export SQL headers omit timestamps so identical schemas hash the same across runs.

---

## Docs

| File | Contents |
| --- | --- |
| [`docs/PROJECT.md`](docs/PROJECT.md) | Full product specification |
| [`docs/APPLICATION_OVERVIEW_AND_PLAN.md`](docs/APPLICATION_OVERVIEW_AND_PLAN.md) | Architecture / implementation notes |
