<!-- Source: 'HHP Database Extractor - Full Project Documentation.docx' (text export). Implementation deviations are listed in README.md. -->

HHP Database Extractor — Full Project Documentation
 
Version: 1.0
Stack: Next.js (App Router) + TypeScript + Tailwind CSS + local filesystem access
Platform: Web app (PWA-friendly) running in the browser with access to local device storage (desktop: C: drive; mobile: shared storage / Files app via File System Access API or Capacitor wrapper)
Audience: Single user, personal use only. Not a multi-tenant SaaS.
 

 
1. Product Overview
 
HHP Database Extractor is a single-user, local-first web application that lets you:
 
1. Register database connections (SQL + NoSQL engines) as "projects".
2. Authenticate against those databases.
3. Extract schema and code objects (tables, stored procedures, functions, triggers, views, etc.) into a structured folder tree on disk organised by project → database → date → timestamp.
4. Keep everything encrypted at rest on disk, unlockable only with the user's master password.
 
The app has no backend server. All logic runs in the Next.js client (or a thin local runtime such as the File System Access API / Capacitor FS plugin). Credentials, project metadata, and exports all live only on the user's device.
 

 
2. Goals & Non-Goals
 
Goals
Zero cloud dependency — everything on-device.
Support extraction of schema + programmability objects to human-readable SQL files (one file per object type, plus optional per-object files).
Deterministic, timestamped output directory structure on C:\ (Windows), user home (macOS/Linux), or app-scoped storage (mobile).
Master-password-protected credential vault using JWT + AES-GCM envelope encryption.
Extensible adapter pattern so new DB engines can be added without touching the UI.
 
Non-Goals
No table-data browsing / BI / query console.
No multi-user accounts, no sync, no telemetry.
No hosted backend, no server-side secrets.
No real-time monitoring or replication.
 

 
3. Target Platforms & Storage Strategy
 
Platform
Storage Root
Access Method
Windows
C:\HHP\
File System Access API (showDirectoryPicker) — user grants C:\HHP once, handle persisted in IndexedDB
macOS
~/HHP/ or user-chosen folder
File System Access API
Linux
~/HHP/
File System Access API
iOS / Android
App document directory (Documents/HHP/)
Capacitor @capacitor/filesystem (preferred) or Web Share + download fallback
 
 
Directory Layout
 
         
    C:\HHP\    
    ├── config\    
    │   ├── user.json            # username, salt, verifier, kdf params (no plaintext password)    
    │   └── meta.json            # app version, schema version, created-at    
    ├── vault\    
    │   ├── projects.enc         # encrypted JWT-wrapped project list    
    │   └── <projectId>\    
    │       └── conn.enc         # encrypted JWT for this connection's credentials    
    └── exports\    
        └── <projectName>\    
            └── <databaseName>\    
                └── 2026-10-19\    
                    └── 2026-10-19T14-32-08Z\    
                        ├── manifest.json    
                        ├── 01_tables.sql    
                        ├── 02_table_columns.sql    
                        ├── 03_primary_keys.sql    
                        ├── 04_foreign_keys.sql    
                        ├── 05_indexes.sql    
                        ├── 06_constraints.sql    
                        ├── 07_views.sql    
                        ├── 08_functions.sql    
                        ├── 09_stored_procedures.sql    
                        ├── 10_triggers.sql    
                        ├── 11_sequences.sql    
                        ├── 12_synonyms.sql    
                        ├── 13_schemas.sql    
                        ├── 14_users_roles.sql    
                        └── objects\    
                            ├── views\<schema>.<name>.sql    
                            ├── functions\<schema>.<name>.sql    
                            ├── procedures\<schema>.<name>.sql    
                            └── triggers\<schema>.<name>.sql    
         
 
Why date + timestamp folders? Immutable history. Every extraction is reproducible and diff-able. Never overwrite a previous snapshot.
 

 
4. Feature List
 
4.1 Authentication (local only)
First-run onboarding: create username + master password.
Password never stored — only a salt + Argon2id-derived verifier (or PBKDF2 via WebCrypto since Argon2 needs WASM — see §6).
Login screen on every app open; session unlocked in memory only (cleared on tab close or 15-min idle).
Optional "auto-lock after inactivity" (default 15 min).
Password strength meter + confirmation.
No password reset. Provide a "Reset Vault" that wipes config\user.json and vault\ after typed confirmation — data loss is explicit.
 
4.2 Encryption & Vault
Master Key (MK) derived from password + salt using PBKDF2-SHA256 (600k iterations) via WebCrypto.
Data Encryption Key (DEK): random 256-bit AES-GCM key, encrypted by MK → stored in user.json. Password change = re-wrap DEK only.
Per-project JWT: credentials signed (HS256) with DEK and then encrypted with AES-GCM before writing to disk. Two-layer: JWT for integrity/claim structure, AES-GCM for confidentiality.
IV/nonce stored alongside ciphertext in a versioned envelope:{ "v": 1, "alg": "AES-GCM", "iv": "base64", "ct": "base64", "kid": "<key-id>" }
 
4.3 Project (Connection) Management
Create/edit/delete projects. Each project stores:
Project name (folder-safe; validated against [^a-zA-Z0-9 _.-])
Engine type: mssql | mysql | postgres | mariadb | oracle | sqlite | mongodb | redis | cassandra
Host, port, database name, schema, user, password (encrypted), SSL options
Optional SSH/tunnel hint (stored as text only — no tunnel implementation in v1)
Tags, notes
Last successful extraction timestamp
Adapter-specific extra fields (e.g., Redis DB index, Mongo authSource)
 
UI: list view with cards, search, "Test Connection" button, "Extract Now" button.
 
4.4 Connection Test
For each adapter, a testConnection() that performs a lightweight handshake (e.g., SELECT 1, PING, db.runCommand({ping:1})) and returns latency + server version.
 
4.5 Extraction Engine
Extraction is adapter-driven. Each adapter implements the DbAdapter interface (§7). The orchestrator:
 
1. Loads project config, decrypts credentials.
2. Opens connection.
3. Runs each extract* method, receives an array of SqlFile objects ({ filename, content, category }).
4. Assembles the export folder, writes to disk.
5. Writes manifest.json with metadata (engine version, extraction duration, object counts, git-style hash of each file for diff detection).
6. Updates lastExtractedAt on the project.
 
Object categories to extract
 
Category
Description
Tables
CREATE TABLE with columns, types, nullability, defaults
Columns
Per-column definitions (helps diffing)
Primary keys

Foreign keys
With ON DELETE/UPDATE rules
Indexes
Unique, partial, composite
Constraints
CHECK, UNIQUE
Views
Full CREATE VIEW
Functions
Scalar + table-valued / stored
Stored procedures

Triggers

Sequences

Schemas

Users / Roles (schema-level only)
Optional, flag-gated
Synonyms
Oracle/MSSQL specific
Extensions
PG only
Mongo: collections, indexes, validators
JS/JSON output, not SQL
Redis: keyspace schema notes
Best-effort
 
 
Each category → one file (NN_<category>.sql) plus one file per object under objects/<category>/. This gives you both a bulk file and granular per-object files for diff-friendly workflows.
 
4.6 Export Options
Before extracting, the user can toggle:
☑ All objects (default)
☑ Split into per-object files
☑ Include IF NOT EXISTS guards
☑ Include USE <db> / SET search_path / USE ROLE header
☑ Emit DROP statements first
☑ Include extraction comments header
☑ Exclude system schemas (sys, information_schema, pg_catalog, dbo optional)
 
4.7 Extraction History
Timeline view per project showing every snapshot (folder + timestamp).
View manifest.json in a read-only modal.
Re-open / re-download any historical snapshot.
Diff summary between two snapshots (v1.1 — count of added/removed/modified objects based on file hashes).
 
4.8 Logs
In-app log viewer with levels (info, warn, error).
Logs kept in-memory for the session + optional C:\HHP\logs\yyyy-mm-dd.log (plaintext, no secrets).
Redaction rule: never log passwords, connection strings, or JWT contents.
 
4.9 Settings
Change master password (re-wrap DEK).
Export / import encrypted vault (whole vault\ folder).
Wipe all data.
Idle auto-lock timeout.
Theme: light / dark / system.
Default export root (path picker).
Default export options.
 
4.10 Mobile / PWA specifics
Installable PWA.
If running as PWA on iOS (File System Access API unsupported), fall back to Capacitor + Filesystem plugin in a native wrapper, or zip download of the export.
Mobile layout: single-column, bottom tab nav (Projects / History / Settings).
 

 
5. UI / UX Sitemap
 
         
    /                       → redirect to /login or /projects    
    /login                  → unlock screen    
    /onboarding             → first-run: create user    
    /projects               → project list (default authenticated landing)    
    /projects/new           → create project form    
    /projects/[id]          → project detail: overview + extract button + history    
    /projects/[id]/edit     → edit project    
    /projects/[id]/extract  → extraction wizard (choose options → progress → result)    
    /history                → all extractions across projects    
    /history/[runId]        → snapshot detail + manifest viewer    
    /settings               → all settings    
    /settings/security      → change password, idle lock    
    /settings/storage       → export root, wipe, backup    
    /logs                   → log viewer    
         
 
Components:
UnlockGate (HOC that redirects to /login if vault not unlocked)
ProjectCard, ProjectForm, EngineBadge
ExtractionWizard (multi-step: options → connect → run → done)
ProgressLog (streaming extraction log)
ManifestViewer
PasswordStrength, TotpQr (future)
ConfirmDangerDialog
 

 
6. Security Design (detailed)
 
6.1 Password → Key derivation
         
    // WebCrypto PBKDF2 (Argon2id is nice but requires WASM bundle; acceptable trade-off)    
    const keyMaterial = await crypto.subtle.importKey(    
      'raw', new TextEncoder().encode(password),    
      'PBKDF2', false, ['deriveBits', 'deriveKey']    
    );    
    const masterKey = await crypto.subtle.deriveKey(    
      { name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' },    
      keyMaterial,    
      { name: 'AES-GCM', length: 256 },    
      false, ['encrypt', 'decrypt']    
    );    
         
 
6.2 config/user.json
         
    {    
      "version": 1,    
      "username": "alice",    
      "salt": "base64-32bytes",    
      "iterations": 600000,    
      "verifier": { "v":1, "alg":"AES-GCM", "iv":"...", "ct":"..." },  // encrypted constant "HHP-OK"    
      "dekEnvelope": { "v":1, "alg":"AES-GCM", "iv":"...", "ct":"..." },// DEK wrapped by MK    
      "createdAt": "2026-10-19T..."    
    }    
         
Login: derive MK → decrypt verifier → compare to "HHP-OK". If match, unwrap DEK → keep in memory.
 
6.3 vault/<projectId>/conn.enc
Steps on save:
1. Build JWT payload { projectId, engine, host, port, database, user, password, ssl, extra, iat }.
2. Sign with HS256 using DEK (32 bytes) → jwt.
3. ct = AES-GCM(DEK, iv, jwt).
4. Write envelope JSON to disk.
 
Steps on load:
1. Read envelope, decrypt with DEK → jwt.
2. Verify signature and exp (none by default; can add rotation).
3. Get payload.
 
Why both JWT and AES-GCM? JWT gives you standard claims, tamper-evidence, and easy interop. AES-GCM gives confidentiality + authenticated encryption. The JWT is never stored in cleartext.
 
6.4 Session
DEK held in a useRef inside a Zustand/Context store. Never in localStorage or sessionStorage.
Auto-lock clears it on idle or visibilitychange (background > 15 min).
Full page reload requires re-unlock.
 
6.5 Threat model notes (put in README)
Protects against: casual access, stolen backup of vault\, accidental plaintext leakage.
Does not protect against: OS-level attacker with process memory access, malicious browser extensions with DOM access, keyloggers. Document this.
 

 
7. Architecture
 
7.1 High-level
 
         
    ┌──────────────────────────────────────────────────────┐    
    │ Next.js App (client-only)                            │    
    │                                                      │    
    │  UI (App Router pages + components)                  │    
    │        │                                             │    
    │        ▼                                             │    
    │  Domain layer (Zustand stores + services)            │    
    │   ├─ AuthService (crypto + vault)                    │    
    │   ├─ ProjectService                                  │    
    │   ├─ ExtractionOrchestrator ──► AdapterRegistry      │    
    │   └─ StorageService (File System Access API / Cap.)  │    
    │        │                                             │    
    │        ▼                                             │    
    │  Adapters (dynamic import per engine)                │    
    │   ├─ MSSQLAdapter                                    │    
    │   ├─ MySQLAdapter / MariaDBAdapter                   │    
    │   ├─ PostgresAdapter                                 │    
    │   ├─ OracleAdapter                                   │    
    │   ├─ SQLiteAdapter                                   │    
    │   ├─ MongoAdapter                                    │    
    │   ├─ RedisAdapter                                    │    
    │   └─ CassandraAdapter                                │    
    └──────────────────────────────────────────────────────┘    
            │    
            ▼    
      Local filesystem (C:\HHP\...)    
         
 
7.2 The adapter contract
 
         
    export interface DbAdapter {    
      readonly engine: EngineId;    
      readonly displayName: string;    
      readonly requiresNetwork: boolean;    
      readonly defaultPort?: number;    
         
      testConnection(cfg: ResolvedConnection): Promise<TestResult>;    
      connect(cfg: ResolvedConnection): Promise<ConnectionHandle>;    
         
      extractAll(    
        conn: ConnectionHandle,    
        opts: ExtractionOptions,    
        onProgress: (evt: ProgressEvent) => void    
      ): Promise<ExtractionResult>;    
         
      close(conn: ConnectionHandle): Promise<void>;    
    }    
         
    export interface ExtractionOptions {    
      includeTables: boolean;    
      includeViews: boolean;    
      includeFunctions: boolean;    
      includeProcedures: boolean;    
      includeTriggers: boolean;    
      includeIndexes: boolean;    
      includeKeys: boolean;    
      includeConstraints: boolean;    
      includeSequences: boolean;    
      includeSchemas: boolean;    
      includeRoles: boolean;    
      splitPerObject: boolean;    
      dropFirst: boolean;    
      useIfNotExists: boolean;    
      excludedSchemas: string[];    
    }    
         
    export interface SqlFile {    
      filename: string;           // e.g. "07_views.sql" or "objects/views/dbo.vUsers.sql"    
      category: ObjectCategory;    
      content: string;    
      sha256: string;             // for manifest    
    }    
         
    export interface ExtractionResult {    
      files: SqlFile[];    
      manifest: Manifest;    
      durationMs: number;    
      warnings: string[];    
    }    
         
 
7.3 Engine connection strategy in a browser
 
This is the hardest engineering constraint: you cannot open a raw TCP socket to MSSQL/Oracle/etc. from a plain browser.
 
Two acceptable paths — pick one per engine:
 
Engine
Browser-native path
Notes
SQLite
sql.js / wa-sqlite (WASM)
✅ Fully browser-viable. User picks .db file via File System Access API.
PostgreSQL
HTTP proxy (user-hosted pg_http-style gateway) or client via postgres npm on a thin local runtime (Tauri/Capacitor)
⚠ Browser can't speak Postgres wire protocol natively; needs WS/TCP bridge
MySQL/MariaDB
Same as PG
⚠
MSSQL
Same as PG
⚠
Oracle
Same as PG
⚠
MongoDB
MongoDB Atlas Data API (HTTPS) or the official mongodb npm with a WS tunnel
⚠
Redis
Redis over WebSocket gateways (e.g. redis-rs-ws)
⚠
Cassandra
Same as PG
⚠
 
 
Recommended architecture for v1 to keep it clean and honest with the "no backend" premise:
 
Run the Next.js app inside a Tauri (desktop) or Capacitor (mobile) shell. Tauri/Capacitor give you a native TCP stack via a plugin. The web layer calls window.__HHP_tcp.* or the Capacitor plugin.
Alternatively, if you want pure browser: ship an optional local sidecar (hhp-bridge, a ~200-line Node/Go binary the user runs once) that exposes a ws://127.0.0.1:PORT gateway. The Next.js UI connects to it. This is still "no backend server" in the deployment sense — the bridge lives on the user's own machine.
 
Document this clearly. Do not pretend the browser alone can talk to MSSQL.
 
7.4 Storage service abstraction
 
         
    export interface StorageService {    
      ensureDir(path: string): Promise<void>;    
      writeTextFile(path: string, content: string): Promise<void>;    
      readTextFile(path: string): Promise<string>;    
      listDir(path: string): Promise<DirEntry[]>;    
      exists(path: string): Promise<boolean>;    
      deletePath(path: string): Promise<void>;    
      pickRoot(): Promise<void>;     // triggers directory picker    
      getRootName(): Promise<string>;    
    }    
         
 
Implementations:
FileSystemAccessStorage (Chromium browsers, Tauri, Electron).
CapacitorStorage (iOS/Android wrapper).
MemoryStorage (tests, and graceful fallback that offers ZIP download instead of writing).
 
Persist the FileSystemDirectoryHandle in IndexedDB so the folder grant survives reloads (idb-keyval recommended).
 

 
8. Data Models (TypeScript)
 
         
    type EngineId = 'mssql'|'mysql'|'mariadb'|'postgres'|'oracle'|'sqlite'|'mongodb'|'redis'|'cassandra';    
         
    interface StoredUser {    
      version: 1;    
      username: string;    
      salt: string;         // b64    
      iterations: number;    
      verifier: Envelope;    
      dekEnvelope: Envelope;    
      createdAt: string;    
    }    
         
    interface Envelope {    
      v: 1;    
      alg: 'AES-GCM';    
      iv: string;  // b64    
      ct: string;  // b64    
    }    
         
    interface Project {    
      id: string;               // uuid    
      name: string;    
      engine: EngineId;    
      tags: string[];    
      notes?: string;    
      createdAt: string;    
      updatedAt: string;    
      lastExtractedAt?: string;    
      lastTestOkAt?: string;    
    }    
         
    interface ConnectionConfig {           // inside JWT payload    
      projectId: string;    
      engine: EngineId;    
      host?: string;    
      port?: number;    
      database: string;    
      schema?: string;    
      username?: string;    
      password?: string;    
      ssl?: 'disable'|'require'|'verify-full';    
      extra?: Record<string, unknown>;    
      iat: number;    
    }    
         
    interface Manifest {    
      version: 1;    
      projectId: string;    
      projectName: string;    
      engine: EngineId;    
      database: string;    
      extractedAt: string;     // ISO    
      durationMs: number;    
      serverVersion?: string;    
      counts: Record<ObjectCategory, number>;    
      files: { path: string; sha256: string; bytes: number }[];    
      warnings: string[];    
      options: ExtractionOptions;    
    }    
         
    type ObjectCategory =    
      | 'tables' | 'columns' | 'primary_keys' | 'foreign_keys' | 'indexes'    
      | 'constraints' | 'views' | 'functions' | 'procedures' | 'triggers'    
      | 'sequences' | 'schemas' | 'roles' | 'synonyms' | 'extensions' | 'collections';    
         
 

 
9. Extraction Orchestrator Flow
 
         
    1. User clicks "Extract Now" on project.    
    2. Wizard opens. Loads saved options.    
    3. On "Run":    
       a. storage.pickRoot() if not chosen yet    
       b. decrypt conn.enc → ConnectionConfig    
       c. adapter.connect(cfg)    
       d. build output dir: exports/<project>/<db>/<yyyy-mm-dd>/<ISO-ts>/    
       e. for each enabled category:    
            - call adapter.extract<Category>()    
            - hash each SqlFile    
            - write file    
            - emit ProgressEvent    
       f. write manifest.json    
       g. adapter.close()    
       h. update project.lastExtractedAt    
       i. show result screen with "Open folder" hint + log download    
    4. Any error → surfaced in wizard + written to logs; partial output folder is kept (marked `_partial`).    
         
 
Progress events (streamed to ProgressLog component):
         
    type ProgressEvent =    
      | { kind: 'phase'; phase: 'connect'|'extract'|'write'|'manifest'|'close' }    
      | { kind: 'category'; category: ObjectCategory; done: number; total?: number }    
      | { kind: 'object'; category: ObjectCategory; name: string }    
      | { kind: 'warn'; message: string }    
      | { kind: 'error'; message: string };    
         
 

 
10. Per-Engine Adapter Notes
 
10.1 MSSQL (mssql npm over TCP bridge)
Extract via sys.objects, sys.columns, sys.sql_modules, sys.indexes, sys.foreign_keys, sys.triggers, sys.procedures, sys.views, sys.objects WHERE type IN ('FN','IF','TF').
Views/procs/functions/triggers: pull definition from sys.sql_modules — preserves original text.
Use OBJECT_DEFINITION(object_id) as a fallback.
Header: USE [<db>];\nGO\n.
 
10.2 MySQL / MariaDB
SHOW CREATE TABLE, SHOW CREATE VIEW, SHOW CREATE PROCEDURE/FUNCTION/TRIGGER.
Query information_schema.STATISTICS, information_schema.TABLE_CONSTRAINTS, information_schema.KEY_COLUMN_USAGE.
Header: USE `<db>`;
MariaDB differences: sequence objects, SHOW CREATE SEQUENCE (10.3+).
 
10.3 PostgreSQL
pg_dump --schema-only --no-owner --no-privileges if bridge supports shelling out — strongly recommended, it's the gold standard.
Fallback: pg_catalog queries + pg_get_viewdef, pg_get_functiondef, pg_get_triggerdef.
Header: SET search_path TO <schema>;
 
10.4 Oracle
Prefer DBMS_METADATA.GET_DDL('TABLE'|'VIEW'|'PROCEDURE'|..., name, owner).
Requires grants. Document prerequisite.
Header: ALTER SESSION SET CURRENT_SCHEMA = <schema>;
 
10.5 SQLite
Read sqlite_master (type IN ('table','index','view','trigger'), sql column).
Fully client-side via sql.js — this is the easiest engine to ship first; use it as the reference adapter.
 
10.6 MongoDB
db.getCollectionInfos() → validators + options.
db.getCollectionNames() → per-collection createIndexes output.
Emit as JSON + a .js mongo-shell file rather than SQL.
Category mapping: collections instead of tables.
 
10.7 Redis
SCAN limited to INFO, CONFIG GET, key-type sampling (bounded), MEMORY USAGE counts.
Emit a .txt schema report + COMMAND DOCS snapshot. This engine is inherently schemaless; set expectations in the UI.
 
10.8 Cassandra
system_schema.tables, .columns, .indexes, .types, .functions, .aggregates, .triggers, .views.
Emit CQL (.cql files).
 

 
11. Project Structure (Next.js App Router)
 
         
    hhp/    
    ├── app/    
    │   ├── layout.tsx    
    │   ├── page.tsx    
    │   ├── (auth)/    
    │   │   ├── login/page.tsx    
    │   │   └── onboarding/page.tsx    
    │   ├── (app)/    
    │   │   ├── layout.tsx                 # UnlockGate + shell (sidebar/tabbar)    
    │   │   ├── projects/page.tsx    
    │   │   ├── projects/new/page.tsx    
    │   │   ├── projects/[id]/page.tsx    
    │   │   ├── projects/[id]/edit/page.tsx    
    │   │   ├── projects/[id]/extract/page.tsx    
    │   │   ├── history/page.tsx    
    │   │   ├── history/[runId]/page.tsx    
    │   │   ├── logs/page.tsx    
    │   │   └── settings/    
    │   │       ├── page.tsx    
    │   │       ├── security/page.tsx    
    │   │       └── storage/page.tsx    
    │   └── api/                           # optional; empty for pure client    
    ├── components/    
    │   ├── ui/                            # shadcn/ui primitives    
    │   ├── auth/{UnlockGate,LoginForm,OnboardingForm}.tsx    
    │   ├── projects/{ProjectCard,ProjectForm,EngineBadge}.tsx    
    │   ├── extraction/{Wizard,ProgressLog,OptionsForm,ResultCard}.tsx    
    │   ├── history/{Timeline,ManifestViewer}.tsx    
    │   └── layout/{Sidebar,TopBar,TabBar}.tsx    
    ├── lib/    
    │   ├── crypto/    
    │   │   ├── kdf.ts                     # PBKDF2 derive, verifier, unwrap    
    │   │   ├── aesgcm.ts                  # envelope encrypt/decrypt    
    │   │   └── jwt.ts                     # sign/verify HS256 helpers    
    │   ├── storage/    
    │   │   ├── index.ts                   # StorageService factory    
    │   │   ├── fs-access.ts    
    │   │   ├── capacitor.ts    
    │   │   └── memory.ts    
    │   ├── adapters/    
    │   │   ├── types.ts    
    │   │   ├── registry.ts    
    │   │   ├── sqlite/index.ts    
    │   │   ├── mssql/index.ts    
    │   │   ├── mysql/index.ts    
    │   │   ├── postgres/index.ts    
    │   │   ├── oracle/index.ts    
    │   │   ├── mongodb/index.ts    
    │   │   ├── redis/index.ts    
    │   │   └── cassandra/index.ts    
    │   ├── services/    
    │   │   ├── auth.service.ts    
    │   │   ├── project.service.ts    
    │   │   ├── extraction.service.ts    
    │   │   └── log.service.ts    
    │   ├── utils/    
    │   │   ├── slug.ts                    # folder-safe names    
    │   │   ├── datetime.ts    
    │   │   └── sha256.ts    
    │   └── schemas/                       # zod schemas for all models    
    ├── stores/    
    │   ├── auth.store.ts                  # DEK in memory only    
    │   ├── project.store.ts    
    │   └── log.store.ts    
    ├── public/    
    ├── styles/    
    ├── tests/    
    │   ├── crypto.test.ts    
    │   ├── adapters/sqlite.test.ts    
    │   └── orchestrator.test.ts    
    ├── next.config.mjs    
    ├── tailwind.config.ts    
    ├── tsconfig.json    
    └── package.json    
         
 
Dependencies (suggested):
next@15, react@19, typescript, tailwindcss, shadcn/ui, lucide-react
zustand, zod, idb-keyval
jsonwebtoken is Node-only — use jose (WebCrypto-based) for JWT.
sql.js (SQLite), mssql, mysql2, pg, oracledb, mongodb, redis, cassandra-driver — but only imported dynamically per adapter and only when running under Tauri/Capacitor/bridge where TCP is available.
@capacitor/core, @capacitor/filesystem (mobile).
 

 
12. Step-by-Step Build Plan (for Cursor)
 
Do these in order. Each step should ship a green build.
 
Milestone 0 — Scaffold (0.5 day)
1. npx create-next-app@latest hhp --ts --tailwind --app --eslint
2. Add shadcn/ui, zustand, zod, jose, idb-keyval, lucide-react.
3. Create the folder skeleton from §11.
4. Add a README.md documenting the threat model and the browser-TCP caveat.
 
Milestone 1 — Crypto + Auth (1–2 days)
5. lib/crypto/kdf.ts: deriveMasterKey(password, salt, iterations), createVerifier, unwrapDek, wrapDek.
6. lib/crypto/aesgcm.ts: encrypt(key, plaintext) → Envelope, decrypt(key, env) → plaintext.
7. lib/crypto/jwt.ts: sign(payload, dek), verify(jwt, dek).
8. lib/storage/fs-access.ts: implement StorageService with showDirectoryPicker + IndexedDB handle persistence.
9. /onboarding: create user → writes config/user.json.
10. /login: unlock → holds DEK in auth.store.
11. UnlockGate wraps (app) route group.
12. Unit tests: crypto round-trip, wrong password rejected, corrupted envelope rejected.
 
Milestone 2 — Projects CRUD (1 day)
13. project.store.ts with add/edit/delete, backed by vault/projects.enc.
14. ProjectForm with engine-specific field groups.
15. ProjectCard list with Test Connection (adapter method, initially stubbed).
16. Project detail page.
 
Milestone 3 — SQLite Adapter (reference impl, 2 days)
17. Implement DbAdapter for SQLite using sql.js — user picks .db file via showOpenFilePicker.
18. Extract sqlite_master rows → categorize by type.
19. Emit 01_tables.sql, 07_views.sql, 09_triggers.sql, 10_indexes.sql + per-object files.
20. Write unit tests with a fixture DB.
 
Milestone 4 — Extraction Orchestrator + Wizard (2 days)
21. ExtractionOrchestrator.run(projectId, options, onProgress).
22. Wizard UI: options → run → progress → result.
23. Write manifest.json, compute SHA-256s.
24. Persist lastExtractedAt.
25. /history timeline per project, /history/[runId] manifest viewer.
 
Milestone 5 — Additional adapters (2 days each)
26. Pick order: Postgres → MySQL/MariaDB → MSSQL → MongoDB → Oracle → Redis → Cassandra.
27. Each adapter has a fixture-based test using a Docker container in CI, or a recorded fixture JSON for offline tests.
 
Milestone 6 — Security hardening (1 day)
28. Idle auto-lock; visibilitychange handler.
29. Change-password flow (rewrap DEK only).
30. Wipe-data flow with typed confirmation.
31. Log redaction tests.
 
Milestone 7 — PWA + mobile packaging (2 days)
32. manifest.webmanifest, icons, next-pwa.
33. Capacitor wrapper repo for iOS/Android with @capacitor/filesystem.
34. Tauri wrapper repo for Windows/macOS/Linux with a TCP plugin.
 
Milestone 8 — Polish
35. Dark mode, empty states, keyboard shortcuts, toasts.
36. Diff view between snapshots (v1.1).
 

 
13. Key Implementation Snippets (copy-paste ready)
 
13.1 Crypto — envelope encryption
         
    // lib/crypto/aesgcm.ts    
    export type Envelope = { v: 1; alg: 'AES-GCM'; iv: string; ct: string };    
         
    const enc = new TextEncoder();    
    const dec = new TextDecoder();    
    const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));    
    const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));    
         
    export async function encrypt(key: CryptoKey, plaintext: string): Promise<Envelope> {    
      const iv = crypto.getRandomValues(new Uint8Array(12));    
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));    
      return { v: 1, alg: 'AES-GCM', iv: b64(iv.buffer), ct: b64(ct) };    
    }    
         
    export async function decrypt(key: CryptoKey, env: Envelope): Promise<string> {    
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, key, unb64(env.ct));    
      return dec.decode(pt);    
    }    
         
 
13.2 KDF + verifier
         
    // lib/crypto/kdf.ts    
    const enc = new TextEncoder();    
         
    export async function deriveMasterKey(password: string, salt: Uint8Array, iterations = 600_000) {    
      const km = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);    
      return crypto.subtle.deriveKey(    
        { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },    
        km,    
        { name: 'AES-GCM', length: 256 },    
        false,    
        ['encrypt', 'decrypt']    
      );    
    }    
         
    export async function unwrapDek(mk: CryptoKey, env: Envelope) {    
      const raw = await crypto.subtle.decrypt(    
        { name: 'AES-GCM', iv: unb64(env.iv) }, mk, unb64(env.ct)    
      );    
      return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);    
    }    
         
 
13.3 JWT helpers
         
    // lib/crypto/jwt.ts    
    import { SignJWT, jwtVerify, type JWTPayload } from 'jose';    
         
    export async function signJwt(payload: JWTPayload, dek: CryptoKey) {    
      const raw = await crypto.subtle.exportKey('raw', dek);    
      return new SignJWT(payload)    
        .setProtectedHeader({ alg: 'HS256' })    
        .setIssuedAt()    
        .sign(new Uint8Array(raw));    
    }    
         
    export async function verifyJwt<T = JWTPayload>(token: string, dek: CryptoKey) {    
      const raw = await crypto.subtle.exportKey('raw', dek);    
      const { payload } = await jwtVerify<T>(token, new Uint8Array(raw));    
      return payload;    
    }    
         
 
13.4 Storage — File System Access API
         
    // lib/storage/fs-access.ts    
    import { get, set } from 'idb-keyval';    
         
    const HANDLE_KEY = 'hhp.rootHandle';    
         
    export const fsStorage: StorageService = {    
      async pickRoot() {    
        const h = await (window as any).showDirectoryPicker({ mode: 'readwrite' });    
        await set(HANDLE_KEY, h);    
        return h;    
      },    
      async getRoot(): Promise<FileSystemDirectoryHandle> {    
        let h = await get<FileSystemDirectoryHandle>(HANDLE_KEY);    
        if (!h) throw new Error('No root chosen');    
        if ((await h.queryPermission({ mode: 'readwrite' })) !== 'granted') {    
          if ((await h.requestPermission({ mode: 'readwrite' })) !== 'granted')    
            throw new Error('Permission denied');    
        }    
        return h;    
      },    
      async ensureDir(path, root) {    
        const parts = path.split('/').filter(Boolean);    
        let dir = await this.getRoot();    
        for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true });    
        return dir;    
      },    
      async writeTextFile(path, content) {    
        const parts = path.split('/');    
        const name = parts.pop()!;    
        const dir = await this.ensureDir(parts.join('/'));    
        const fh = await dir.getFileHandle(name, { create: true });    
        const w = await fh.createWritable();    
        await w.write(content);    
        await w.close();    
      },    
      // ...readTextFile, listDir, exists, deletePath    
    };    
         
 
13.5 SQLite adapter skeleton
         
    // lib/adapters/sqlite/index.ts    
    import initSqlJs from 'sql.js';    
    import type { DbAdapter, SqlFile } from '../types';    
         
    export const sqliteAdapter: DbAdapter = {    
      engine: 'sqlite',    
      displayName: 'SQLite',    
      requiresNetwork: false,    
         
      async testConnection(cfg) { /* open file, SELECT 1 */ return { ok: true, latencyMs: 5 }; },    
      async connect(cfg) { /* return { db } */ },    
      async close(h) { h.db.close(); },    
         
      async extractAll(conn, opts, onProgress) {    
        const files: SqlFile[] = [];    
        const { db } = conn;    
        const rows = db.exec(`SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL`);    
        const byType: Record<string, { name: string; sql: string }[]> = {};    
        for (const r of rows[0].values) {    
          const [type, name, , sql] = r as [string, string, string, string];    
          (byType[type] ??= []).push({ name, sql });    
        }    
        const push = (filename: string, category: any, body: string) =>    
          files.push({ filename, category, content: body, sha256: '' /* fill later */ });    
         
        if (opts.includeTables)    
          push('01_tables.sql', 'tables', (byType.table ?? []).map(o => o.sql + ';\n').join('\n'));    
        if (opts.includeViews)    
          push('07_views.sql', 'views', (byType.view ?? []).map(o => o.sql + ';\n').join('\n'));    
        if (opts.includeIndexes)    
          push('05_indexes.sql', 'indexes', (byType.index ?? []).map(o => o.sql + ';\n').join('\n'));    
        if (opts.includeTriggers)    
          push('10_triggers.sql', 'triggers', (byType.trigger ?? []).map(o => o.sql + ';\n').join('\n'));    
         
        onProgress({ kind: 'phase', phase: 'extract' });    
        return { files, manifest: {} as any, durationMs: 0, warnings: [] };    
      },    
    };    
         
 
13.6 Orchestrator
         
    // lib/services/extraction.service.ts    
    export async function runExtraction(    
      projectId: string,    
      options: ExtractionOptions,    
      onProgress: (e: ProgressEvent) => void    
    ) {    
      const project = useProjectStore.getState().get(projectId);    
      const dek = useAuthStore.getState().dek;    
      if (!dek) throw new Error('Locked');    
         
      const connEnv = JSON.parse(await fsStorage.readTextFile(`vault/${projectId}/conn.enc`));    
      const jwt = await decrypt(dek, connEnv);    
      const cfg = await verifyJwt<ConnectionConfig>(jwt, dek);    
         
      const adapter = registry[project.engine];    
      const started = Date.now();    
      const conn = await adapter.connect(cfg);    
      const { files } = await adapter.extractAll(conn, options, onProgress);    
      await adapter.close(conn);    
         
      const stamp = new Date().toISOString();                // 2026-10-19T14:32:08.123Z    
      const date = stamp.slice(0, 10);                        // 2026-10-19    
      const time = stamp.slice(11, 19).replaceAll(':', '-');  // 14-32-08    
      const dir = `exports/${slug(project.name)}/${slug(cfg.database)}/${date}/${time}`;    
         
      for (const f of files) {    
        f.sha256 = await sha256Hex(f.content);    
        await fsStorage.writeTextFile(`${dir}/${f.filename}`, f.content);    
        onProgress({ kind: 'object', category: f.category, name: f.filename });    
      }    
         
      const manifest: Manifest = buildManifest(project, cfg, options, files, Date.now() - started);    
      await fsStorage.writeTextFile(`${dir}/manifest.json`, JSON.stringify(manifest, null, 2));    
         
      useProjectStore.getState().markExtracted(projectId, stamp);    
      return { dir, manifest };    
    }    
         
 

 
14. Testing Strategy
 
Unit: crypto round-trips, KDF with wrong password, envelope tamper detection, JWT verify failures, slug sanitization, manifest hashing.
Adapter fixtures: for each engine, keep a recorded schema fixture (JSON) and snapshot-test the generated SQL.
E2E: Playwright against a Chromium build with File System Access API mocked by an in-memory StorageService. Full onboarding → add SQLite project → extract → verify output files exist and match snapshot.
No real DB required in CI for most adapters (fixtures suffice); one optional docker-compose.test.yml for live smoke tests.
 

 
15. Acceptance Criteria (definition of done)
 
First-run onboarding creates config/user.json and vault/.
Wrong password → verifier fails; no DEK unwrapped.
Password is never present in any file on disk (verified by grep in tests).
Adding a project stores an AES-GCM envelope + JWT, not plaintext.
Extracting a SQLite DB produces the full folder tree from §3 with all enabled files.
Each exported file is byte-identical to the reference snapshot in tests.
manifest.json includes SHA-256 for every file.
History page lists every run and opens the manifest.
Auto-lock after configured idle time.
Works in Chromium desktop with File System Access API (directory handle persists across reload).
PWA installs and (with Capacitor wrapper) extracts on iOS/Android to Documents/HHP/.
Logs never contain passwords or connection strings (verified by test).
Zero network requests from the app itself except to the user-configured DB endpoint.
 

 
16. Risks & Open Questions
 
1. Browser TCP limitation — must be resolved by choosing Tauri/Capacitor or the local hhp-bridge sidecar before adapter work begins. Decide in Milestone 0.
2. Oracle licensing / client libs — oracledb requires Oracle Instant Client for thick mode; thin mode works for most reads. Document it.
3. Argon2 vs PBKDF2 — if Argon2id WASM (argon2-browser) is acceptable in bundle size (~200 KB), switch. Otherwise stay PBKDF2.
4. JWT expiry / rotation — v1 has no rotation; DEK is stable for life of vault. Add later.
5. Very large schemas — extract streams to disk per-object to avoid holding whole DB in memory.
6. Redis/Mongo — "SQL file" concept doesn't fit; the export folder will mix .sql, .js, .json, .cql. Keep manifest.json as the machine-readable source of truth.
 

 
17. License & Personal-Use Notice
 
This is a personal-use, single-user tool. Ship with a README that states: "Do not use to store credentials for systems you do not own. Data loss from forgotten passwords is unrecoverable by design."
 

 
This document is intended to be dropped into Cursor as project context. Save as docs/PROJECT.md in the repo root and reference it in .cursorrules:
 
         
    Always follow docs/PROJECT.md.    
    Prefer the adapter interface in lib/adapters/types.ts.    
    Never store plaintext passwords, DEK, or JWT outside memory.    
    All crypto via lib/crypto/*; all disk I/O via lib/storage/*.    
    Run `pnpm test` and `pnpm typecheck` before proposing a diff.    
         
