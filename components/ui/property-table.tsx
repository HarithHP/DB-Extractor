"use client";

import * as React from "react";
import { DataTable, type DataTableColumn } from "./data-table";

export interface PropertyRow {
  key: string;
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
}

const columns: DataTableColumn<PropertyRow>[] = [
  {
    id: "label",
    header: "Property",
    className: "w-[38%] font-medium",
    cell: (r) => (
      <div>
        <div>{r.label}</div>
        {r.hint ? <div className="mt-0.5 text-xs font-normal text-muted-foreground">{r.hint}</div> : null}
      </div>
    ),
  },
  { id: "value", header: "Value", cell: (r) => <div className="min-w-0 break-words">{r.value}</div> },
];

/** Two-column label/value table built on DataTable so it shares the table theme tokens. */
export function PropertyTable({ rows, caption }: { rows: PropertyRow[]; caption?: string }) {
  return <DataTable columns={columns} rows={rows} rowKey={(r) => r.key} caption={caption} dense striped />;
}
