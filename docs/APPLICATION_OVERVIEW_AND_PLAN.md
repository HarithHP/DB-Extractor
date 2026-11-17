# HHP Database Extractor — System Architecture, Feature Audit & Implementation Plan

## 1. Executive Summary

**HHP Database Extractor** is a local-first, privacy-centric single-user desktop web application designed to extract database schemas and programmability code objects (tables, views, stored procedures, functions, triggers, indexes, foreign keys, constraints, etc.) into an immutable, timestamped file hierarchy on local storage (e.g., `C:\HHP\exports\...`).

The system relies on a **zero-cloud, zero-telemetry architecture**:
- **Credentials & Connection Strings**: Stored exclusively on the user's disk in a cryptographic vault (`vault/`) protected by a master password via PBKDF2-SHA256 (600,000 rounds) and AES-GCM envelope encryption.
- **Stateless Localhost Bridge**: Because browsers cannot open raw TCP sockets to databases (PostgreSQL, MySQL, SQL Server, Oracle, etc.), the local Next.js server bound strictly to `127.0.0.1` acts as a secure stateless bridge. It decrypts credentials in memory per request, connects to the database via native Node.js drivers, executes catalog queries, scrubs sensitive credentials from error traces, and returns structured metadata.

---

## 2. Complete Application Architecture

```mermaid
graph TD
    User([User Browser UI]) -->|Input Master Password| Auth[WebCrypto PBKDF2 KDF]
    Auth -->|Derive MK & Unwrap| DEK[In-Memory DEK Store]
    
    User -->|Project Config| Vault[AES-GCM + JWT Vault]
    Vault <-->|Encrypted Read/Write| Storage[Local Disk / File System Access API]
    
    User -->|Test / Extract SQLite| SqlJs[In-Browser sql.js WASM]
    SqlJs <-->|Direct File Access| Storage
    
    User -->|Test / Extract Remote DB| BridgeClient[Client Adapter / remote.ts]
    BridgeClient -->|POST /api/bridge/:engine/:action| BridgeRoute[Local Next.js Bridge Route]
    
    BridgeRoute -->|pg Driver| PG[(PostgreSQL)]
    BridgeRoute -.->|mysql2 Driver (Planned)| MySQL[(MySQL / MariaDB)]
    BridgeRoute -.->|tedious/mssql (Planned)| MSSQL[(SQL Server)]
```

### 2.1 Technology Stack
- **Framework**: Next.js 16 (App Router), React 19, TypeScript
- **Styling**: Tailwind CSS v4, `next-themes` (Dark/Light mode with curated palettes)
- **Local Database Engine**: `sql.js` (WebAssembly SQLite)
- **State Management**: Zustand v5 (`auth.store.ts`, `project.store.ts`, `log.store.ts`)
- **Validation**: Zod v4 schemas (`lib/schemas/index.ts`)
- **Cryptography**: Native WebCrypto (`PBKDF2-SHA256`, `AES-GCM-256`, `HMAC-SHA256`) + `jose` for signed JWT envelopes
- **Storage Layer**: File System Access API (`showDirectoryPicker`) on Chromium desktop; IndexedDB / OPFS fallback on Safari/Firefox/Mobile; `fflate` for client-side ZIP snapshot downloads
- **Testing**: Vitest v5 with in-process mock and PGlite socket testing

---

## 3. Detailed Feature Breakdown

### 3.1 Authentication & Encrypted Vault
- **Master Password**: Never stored on disk in plaintext.
- **KDF**: PBKDF2-SHA256 with 600,000 iterations and a 32-byte cryptographically secure random salt.
- **Data Encryption Key (DEK)**: 256-bit AES-GCM key, encrypted (wrapped) by the Master Key and stored in `config/user.json`.
- **Envelope Encryption**: Projects and credentials are signed as an HS256 JWT (for integrity and structure) and then encrypted with AES-GCM-256 before being written to disk (`vault/projects.enc` and `vault/<projectId>/conn.enc`).
- **Memory Security**: DEK resides only in Zustand in-memory state; it is never persisted to `localStorage` or `sessionStorage`. Refreshing or locking clears the memory.

### 3.2 Storage Layout
All data is stored inside a user-chosen local root folder (e.g. `C:\HHP`):
```text
<root>/
├── config/
│   ├── user.json            # Salt, iterations, verifier envelope, wrapped DEK
│   ├── meta.json            # App version, schema version, created timestamp
│   └── settings.json        # Non-secret user preferences (default extraction options)
├── vault/
│   ├── projects.enc         # Encrypted list of registered projects
│   └── <projectId>/
│       └── conn.enc         # Encrypted connection parameters and credentials
├── exports/
│   └── <projectName>/
│       └── <databaseName>/
│           └── <YYYY-MM-DD>/
│               └── <YYYY-MM-DDTHH-mm-ssZ>/
│                   ├── manifest.json
│                   ├── 01_tables.sql
│                   ├── 02_table_columns.sql
│                   ├── ...
│                   ├── 14_users_roles.sql
│                   └── objects/
│                       ├── tables/<schema>.<name>.sql
│                       ├── views/<schema>.<name>.sql
│                       ├── procedures/<schema>.<name>.sql
│                       └── triggers/<schema>.<name>.sql
└── logs/
    └── <YYYY-MM-DD>.log     # Optional plaintext logs with secrets strictly redacted
```

### 3.3 Project (Connection) Management
- Supports multi-database projects: PostgreSQL, SQLite, MySQL, MariaDB, SQL Server (MSSQL), Oracle, MongoDB, Redis, Cassandra.
- Project metadata: name (folder-safe regex validation), tags, notes, engine type.
- Connection config: host, port, database, schema, username, password (encrypted), SSL mode (`disable`, `require`, `verify-full`), SSH/tunnel hints, and engine-specific options.
- Redaction service: any password entered is immediately registered with `lib/services/log.service.ts` so it is scrubbed from UI errors, bridge responses, and logs.

### 3.4 Connection Diagnostics & Testing
- Connection test pipeline classifies failures into distinct stages:
  1. `input`: Form validation errors
  2. `vault`: Decryption or storage errors
  3. `network`: Browser-to-Next.js server connection issues
  4. `bridge`: Localhost bridge route status
  5. `driver`: Database driver initialization
  6. `db_network`: Host resolution (DNS), connection refused, network timeout
  7. `db_tls`: SSL/TLS negotiation, certificate validation issues
  8. `db_auth`: Authentication failure, invalid credentials, missing permissions
  9. `db_query`: Query execution failure or timeout
- Diagnostic hints provide actionable remediation steps for developers and DBAs.

### 3.5 Extraction & Snapshot Generation
- 16 distinct object categories extracted in topological dependency order:
  `tables`, `columns`, `primary_keys`, `foreign_keys`, `indexes`, `constraints`, `views`, `functions`, `procedures`, `triggers`, `sequences`, `synonyms`, `schemas`, `roles`, `extensions`, `collections`.
- Formats dual outputs:
  - **Bulk files**: Combined scripts (`01_tables.sql`, `07_views.sql`, etc.)
  - **Per-object files**: Individual files in `objects/<category>/<schema>.<name>.sql` optimized for Git diffs.
- Manifest generation (`manifest.json`): captures execution time, object counts, server version, extraction options, and SHA-256 hashes of every generated file.
- Partial runs: if an extraction fails halfway, the partial files are retained and marked with a `_partial` indicator to avoid data loss.

---

## 4. Root Cause Analysis: Why MySQL & MSSQL Connections Fail

When attempting to connect or test MySQL / MariaDB and MS SQL databases, the test fails with:
> **"MySQL driver is not available yet"** / **"SQL Server driver is not available yet"**  
> `POST /api/bridge/mysql/test -> 501 Not Implemented (DRIVER_NOT_AVAILABLE)`

### Identified Root Causes:
1. **Missing Node.js Driver Dependencies**:
   - `package.json` only contains the PostgreSQL driver (`pg` and `@types/pg`).
   - Neither `mysql2` nor `tedious` / `mssql` is installed.
2. **Bridge Route Handler Unimplemented for Other Engines**:
   - In `app/api/bridge/[engine]/[action]/route.ts`, the `HANDLERS` dictionary only registers `postgres`:
     ```typescript
     const HANDLERS: Partial<Record<EngineId, EngineHandlers>> = {
       postgres: { test: testPostgres, extract: extractFromPostgres },
     };
     ```
   - All other engines immediately fall through line 91 and return HTTP `501 DRIVER_NOT_AVAILABLE`.
3. **Adapters Marked Inactive**:
   - In `lib/adapters/mysql/index.ts` and `lib/adapters/mssql/index.ts`, `available: true` is omitted in `createRemoteAdapter(...)`, causing `supportedInCurrentMilestone` to be `false`.
4. **Missing Extraction & Catalog Query Modules**:
   - PostgreSQL has a dedicated directory `lib/bridge/postgres/` (`client.ts`, `errors.ts`, `extract.ts`, `index.ts`).
   - MySQL and MSSQL currently lack the bridge client, error classification, and catalog query extractors.

---

## 5. Implementation Status: MySQL & MSSQL Support (Completed)

All phases have been implemented and verified:
- [x] **Phase 1**: Installed `mysql2` and `tedious` (pure TypeScript/JavaScript drivers with zero native C++ compile requirements).
- [x] **Phase 2**: Created full MySQL/MariaDB bridge under `lib/bridge/mysql/` (`client.ts`, `errors.ts`, `extract.ts`, `index.ts`) supporting connection testing, error classification with password scrubbing, and `information_schema` catalog extraction.
- [x] **Phase 3**: Created full MS SQL Server bridge under `lib/bridge/mssql/` (`client.ts`, `errors.ts`, `extract.ts`, `index.ts`) supporting connection testing, error classification with password scrubbing, and `sys` catalog extraction.
- [x] **Phase 4**: Registered `mysql`, `mariadb`, and `mssql` in `app/api/bridge/[engine]/[action]/route.ts` and set `available: true` in `lib/adapters/mysql/index.ts` and `lib/adapters/mssql/index.ts`.
- [x] **Phase 5**: Added unit tests in `tests/mysql-bridge.test.ts` and `tests/mssql-bridge.test.ts`. All 71 tests in 9 test suites pass cleanly and `npm run typecheck` passes with 0 errors.

### Implementation Architecture Details:
1. **MySQL / MariaDB**:
   - Install `mysql2` and `@types/node`.
   - `mysql2` provides Promise-based queries, SSL/TLS support, and handles both MySQL 5.7/8.x and MariaDB.
2. **Microsoft SQL Server (MSSQL)**:
   - Install `tedious` (and its types) or `mssql`.
   - `tedious` is the pure-JavaScript implementation of the TDS protocol used by Microsoft SQL Server and Azure SQL, with full support for Windows Azure, SQL 2008-2022, and SSL encryption.

### Phase 2: MySQL & MariaDB Bridge Implementation (`lib/bridge/mysql/`)
Create four modular files mirroring the architecture of `lib/bridge/postgres/`:
1. `lib/bridge/mysql/client.ts`:
   - Connection management with connection timeout (10s) and statement timeout.
   - Enforce read-only transactions: `SET SESSION TRANSACTION READ ONLY`.
   - SSL/TLS configuration (`disable`, `require`, `verify-full`).
2. `lib/bridge/mysql/errors.ts`:
   - Classify MySQL error numbers / SQLSTATE codes:
     - `ER_ACCESS_DENIED_ERROR` (1045) -> `DB_AUTH_FAILED`
     - `ER_BAD_DB_ERROR` (1049) -> `DB_DATABASE_NOT_FOUND`
     - `ECONNREFUSED` -> `DB_CONNECTION_REFUSED`
     - `ETIMEDOUT` / `PROTOCOL_CONNECTION_LOST` -> `DB_TIMEOUT` / `DB_CONNECTION_RESET`
     - `HANDSHAKE_ERROR` -> `DB_TLS_ERROR`
   - Password scrubbing and error sanitization.
3. `lib/bridge/mysql/extract.ts`:
   - Catalog queries using `information_schema`:
     - Tables, columns, data types, nullability, defaults, column comments.
     - Primary keys (`TABLE_CONSTRAINTS`, `KEY_COLUMN_USAGE`).
     - Foreign keys with `UPDATE_RULE` and `DELETE_RULE` (`REFERENTIAL_CONSTRAINTS`).
     - Indexes (`STATISTICS`).
     - Check constraints (`CHECK_CONSTRAINTS`).
     - Views (`VIEWS.VIEW_DEFINITION`).
     - Stored procedures & functions (`ROUTINES.ROUTINE_DEFINITION`).
     - Triggers (`TRIGGERS.ACTION_STATEMENT`).
4. `lib/bridge/mysql/index.ts`:
   - Expose `testMysql` and `extractFromMysql`.

### Phase 3: Microsoft SQL Server Bridge Implementation (`lib/bridge/mssql/`)
Create four modular files mirroring the architecture:
1. `lib/bridge/mssql/client.ts`:
   - Client connection via `tedious` / `mssql`.
   - Read-only transaction enforcement: `SET TRANSACTION ISOLATION LEVEL SNAPSHOT` or `READ UNCOMMITTED`.
   - SSL encryption options (`encrypt: true`, `trustServerCertificate`).
2. `lib/bridge/mssql/errors.ts`:
   - Classify SQL Server error numbers:
     - Error 18456 -> `DB_AUTH_FAILED` (Login failed for user)
     - Error 4060 -> `DB_DATABASE_NOT_FOUND` (Cannot open database)
     - Error 229 / 230 -> `DB_PERMISSION_DENIED`
     - Network errors: `ELOGIN`, `ESOCKET`, `ETIMEOUT`
   - Password redaction.
3. `lib/bridge/mssql/extract.ts`:
   - Catalog queries using SQL Server's `sys` catalog views:
     - `sys.tables`, `sys.columns`, `sys.types`, `sys.default_constraints`, `sys.identity_columns`.
     - `sys.key_constraints`, `sys.index_columns`.
     - `sys.foreign_keys`, `sys.foreign_key_columns`.
     - `sys.indexes`.
     - `sys.views` and `OBJECT_DEFINITION(object_id)`.
     - `sys.procedures` and `sys.objects` (functions, stored procedures, triggers).
     - Schemas from `sys.schemas`.
4. `lib/bridge/mssql/index.ts`:
   - Expose `testMssql` and `extractFromMssql`.

### Phase 4: Integration with Bridge Route & Adapters
1. Update `app/api/bridge/[engine]/[action]/route.ts`:
   - Add `mysql`, `mariadb`, and `mssql` handlers into `HANDLERS`.
2. Update `lib/adapters/mysql/index.ts`:
   - Enable `available: true` for both `mysqlAdapter` and `mariadbAdapter`.
3. Update `lib/adapters/mssql/index.ts`:
   - Enable `available: true` for `mssqlAdapter`.

### Phase 5: Verification & Testing
1. Add unit tests in `tests/` for MySQL and MSSQL error classification and mock client queries.
2. Verify connection test failure diagnostics handle network timeouts, refused ports, invalid credentials, and non-existent databases gracefully with informative hints.
3. Run `npm run typecheck` and `npm test` to verify zero regressions.
4. Test project creation and connection testing workflow in the UI.
