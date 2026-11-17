"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/label";
import type { ExtractionMode, ExtractionOptions } from "@/lib/schemas";

const OBJECT_TOGGLES: { key: keyof ExtractionOptions; label: string }[] = [
  { key: "includeTables", label: "Tables (01_tables.sql)" },
  { key: "includeColumns", label: "Table columns (02_table_columns.sql)" },
  { key: "includeKeys", label: "Primary & foreign keys (03/04)" },
  { key: "includeIndexes", label: "Indexes (05_indexes.sql)" },
  { key: "includeConstraints", label: "Constraints (06_constraints.sql)" },
  { key: "includeViews", label: "Views (07_views.sql)" },
  { key: "includeFunctions", label: "Functions (08_functions.sql)" },
  { key: "includeProcedures", label: "Stored procedures (09_stored_procedures.sql)" },
  { key: "includeTriggers", label: "Triggers (10_triggers.sql)" },
  { key: "includeSequences", label: "Sequences (11_sequences.sql)" },
  { key: "includeSynonyms", label: "Synonyms (12_synonyms.sql)" },
  { key: "includeSchemas", label: "Schemas (13_schemas.sql)" },
  { key: "includeRoles", label: "Users / roles (14_users_roles.sql)" },
];

const OUTPUT_TOGGLES: { key: keyof ExtractionOptions; label: string; hint: string }[] = [
  {
    key: "splitPerObject",
    label: "Split into per-object files",
    hint: "Also writes objects/<category>/<schema>.<name>.sql for clean diffs.",
  },
  {
    key: "useIfNotExists",
    label: "Include IF NOT EXISTS guards",
    hint: "Rewrites CREATE statements with IF NOT EXISTS where supported.",
  },
  {
    key: "includeUseDatabaseHeader",
    label: "Include USE <db> / SET search_path / PRAGMA header",
    hint: "Prepends the engine-specific database/session context header.",
  },
  {
    key: "dropFirst",
    label: "Emit DROP statements first",
    hint: "Prepends DROP <OBJECT> IF EXISTS before each CREATE statement.",
  },
  {
    key: "includeHeaderComments",
    label: "Include extraction comment header",
    hint: "Deterministic header comment (no timestamp, so identical schemas hash identically).",
  },
  {
    key: "excludeSystemSchemas",
    label: "Exclude system schemas / internal tables",
    hint: "Skips sys, information_schema, pg_catalog, sqlite_*, etc.",
  },
];

const MODES: { value: ExtractionMode; label: string; hint: string }[] = [
  {
    value: "schema",
    label: "Schema only",
    hint: "Structure and programmability objects — no table row data.",
  },
  {
    value: "full_sql",
    label: "Full backup (SQL)",
    hint: "Schema plus all user-table rows as portable INSERT scripts.",
  },
  {
    value: "native",
    label: "Native backup",
    hint: "Engine dump tool when available (pg_dump / mysqldump / SQLite file copy); otherwise full SQL with a warning.",
  },
];

export function OptionsForm({
  value,
  onChange,
}: {
  value: ExtractionOptions;
  onChange: (next: ExtractionOptions) => void;
}) {
  const allObjectsChecked = OBJECT_TOGGLES.every((t) => Boolean(value[t.key]));
  const includesData = value.mode === "full_sql" || value.mode === "native";

  function toggleAllObjects(checked: boolean) {
    const patch: Partial<ExtractionOptions> = {};
    for (const t of OBJECT_TOGGLES) (patch as Record<string, boolean>)[t.key] = checked;
    onChange({ ...value, ...patch });
  }

  function setMode(mode: ExtractionMode) {
    onChange({
      ...value,
      mode,
      includeTableData: mode === "full_sql" || mode === "native",
    });
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <p className="border-b pb-2 text-sm font-semibold">Backup mode</p>
        <Field label="Mode" htmlFor="opt-mode">
          <NativeSelect
            id="opt-mode"
            value={value.mode ?? "schema"}
            onChange={(e) => setMode(e.target.value as ExtractionMode)}
          >
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <p className="text-xs text-muted-foreground">
          {MODES.find((m) => m.value === (value.mode ?? "schema"))?.hint}
        </p>
        {includesData ? (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-950 dark:text-amber-100">
            All user tables will be exported with every row. Large databases may take a long time and produce large
            snapshot folders.
          </p>
        ) : null}
        {includesData ? (
          <Field label="INSERT batch size (rows)" htmlFor="opt-batch">
            <Input
              id="opt-batch"
              type="number"
              min={1}
              max={5000}
              value={value.dataBatchSize ?? 500}
              onChange={(e) =>
                onChange({
                  ...value,
                  dataBatchSize: Math.min(5000, Math.max(1, Number(e.target.value) || 500)),
                })
              }
            />
          </Field>
        ) : null}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between border-b pb-2">
          <p className="text-sm font-semibold">Object categories</p>
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
            <Checkbox
              checked={allObjectsChecked}
              onCheckedChange={(c) => toggleAllObjects(Boolean(c))}
            />
            All objects
          </label>
        </div>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {OBJECT_TOGGLES.map((item) => {
            const id = `opt-${item.key}`;
            return (
              <label key={item.key} htmlFor={id} className="flex cursor-pointer items-center gap-2.5 text-sm">
                <Checkbox
                  id={id}
                  checked={Boolean(value[item.key])}
                  onCheckedChange={(c) => onChange({ ...value, [item.key]: Boolean(c) })}
                />
                <Label htmlFor={id} className="cursor-pointer font-normal">
                  {item.label}
                </Label>
              </label>
            );
          })}
        </div>
      </div>

      <div className="space-y-3">
        <p className="border-b pb-2 text-sm font-semibold">Formatting &amp; output options</p>
        <div className="space-y-3">
          {OUTPUT_TOGGLES.map((item) => {
            const id = `opt-${item.key}`;
            return (
              <label key={item.key} htmlFor={id} className="flex cursor-pointer items-start gap-2.5">
                <Checkbox
                  id={id}
                  className="mt-0.5"
                  checked={Boolean(value[item.key])}
                  onCheckedChange={(c) => onChange({ ...value, [item.key]: Boolean(c) })}
                />
                <div className="space-y-0.5">
                  <p className="text-sm font-medium leading-none">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.hint}</p>
                </div>
              </label>
            );
          })}
        </div>
      </div>

      <Field
        label="Excluded schema / table prefixes (comma-separated)"
        htmlFor="opt-excluded-schemas"
      >
        <Input
          id="opt-excluded-schemas"
          value={value.excludedSchemas.join(", ")}
          onChange={(e) =>
            onChange({
              ...value,
              excludedSchemas: e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        />
      </Field>
    </div>
  );
}
