"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Search } from "lucide-react";
import { Button } from "./button";
import { Input } from "./input";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  type CellAlign,
} from "./table";
import { cn } from "@/lib/utils/cn";

export interface DataTableColumn<T> {
  /** Stable identifier, also used as the sort key. */
  id: string;
  header: React.ReactNode;
  cell: (row: T, index: number) => React.ReactNode;
  align?: CellAlign;
  /** Enables header click-to-sort using this value. */
  sortValue?: (row: T) => string | number;
  className?: string;
  headerClassName?: string;
  /**
   * How the column renders on small screens, where rows become stacked cards:
   * `title` is the card heading, `actions` goes in the card footer, `hidden` is omitted.
   */
  mobile?: "title" | "field" | "actions" | "hidden";
  /** Hide on desktop below `lg` to keep wide tables readable on tablets. */
  hideBelowLg?: boolean;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  /** Rendered when there are no rows (after filtering). */
  empty?: React.ReactNode;
  /** Enables the built-in search box; returns the text a row is matched against. */
  searchText?: (row: T) => string;
  searchPlaceholder?: string;
  /** Extra controls rendered beside the search box. */
  toolbar?: React.ReactNode;
  initialSort?: { id: string; direction: "asc" | "desc" };
  pageSize?: number;
  onRowClick?: (row: T) => void;
  striped?: boolean;
  dense?: boolean;
  caption?: React.ReactNode;
  className?: string;
}

type SortState = { id: string; direction: "asc" | "desc" } | null;

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  searchText,
  searchPlaceholder = "Search...",
  toolbar,
  initialSort,
  pageSize,
  onRowClick,
  striped = false,
  dense = false,
  caption,
  className,
}: DataTableProps<T>) {
  const [query, setQuery] = React.useState("");
  const [sort, setSort] = React.useState<SortState>(initialSort ?? null);
  const [page, setPage] = React.useState(0);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !searchText) return rows;
    return rows.filter((r) => searchText(r).toLowerCase().includes(q));
  }, [rows, query, searchText]);

  const sorted = React.useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.id === sort.id);
    if (!col?.sortValue) return filtered;
    const get = col.sortValue;
    const dir = sort.direction === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [filtered, sort, columns]);

  const pageCount = pageSize ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const currentPage = Math.min(page, pageCount - 1);
  const visible = pageSize ? sorted.slice(currentPage * pageSize, (currentPage + 1) * pageSize) : sorted;

  function toggleSort(id: string) {
    setPage(0);
    setSort((prev) => {
      if (!prev || prev.id !== id) return { id, direction: "asc" };
      if (prev.direction === "asc") return { id, direction: "desc" };
      return null;
    });
  }

  const titleCol = columns.find((c) => c.mobile === "title");
  const actionCols = columns.filter((c) => c.mobile === "actions");
  const fieldCols = columns.filter((c) => !c.mobile || c.mobile === "field");
  const cellPad = dense ? "py-2" : undefined;

  return (
    <div className={cn("space-y-3", className)}>
      {searchText || toolbar ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {searchText ? (
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
                placeholder={searchPlaceholder}
                className="pl-9"
                aria-label={searchPlaceholder}
              />
            </div>
          ) : (
            <span />
          )}
          {toolbar ? <div className="flex flex-wrap items-center gap-2">{toolbar}</div> : null}
        </div>
      ) : null}

      {visible.length === 0 ? (
        (empty ?? (
          <div className="rounded-card border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
            {query ? `No results for "${query}".` : "Nothing to show yet."}
          </div>
        ))
      ) : (
        <>
          {/* Desktop / tablet: real table */}
          <TableContainer className="hidden md:block">
            <Table>
              {caption ? <caption className="sr-only">{caption}</caption> : null}
              <TableHeader>
                <tr>
                  {columns.map((col) => {
                    const active = sort?.id === col.id;
                    return (
                      <TableHead
                        key={col.id}
                        align={col.align}
                        className={cn(col.hideBelowLg && "hidden lg:table-cell", col.headerClassName)}
                        aria-sort={active ? (sort!.direction === "asc" ? "ascending" : "descending") : undefined}
                      >
                        {col.sortValue ? (
                          <button
                            type="button"
                            onClick={() => toggleSort(col.id)}
                            className={cn(
                              "inline-flex items-center gap-1 uppercase tracking-wider hover:text-foreground",
                              active && "text-foreground",
                            )}
                          >
                            {col.header}
                            {active ? (
                              sort!.direction === "asc" ? (
                                <ArrowUp className="size-3" />
                              ) : (
                                <ArrowDown className="size-3" />
                              )
                            ) : (
                              <ChevronsUpDown className="size-3 opacity-50" />
                            )}
                          </button>
                        ) : (
                          col.header
                        )}
                      </TableHead>
                    );
                  })}
                </tr>
              </TableHeader>
              <TableBody>
                {visible.map((row, i) => (
                  <TableRow
                    key={rowKey(row, i)}
                    striped={striped}
                    interactive={Boolean(onRowClick)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {columns.map((col) => (
                      <TableCell
                        key={col.id}
                        align={col.align}
                        className={cn(cellPad, col.hideBelowLg && "hidden lg:table-cell", col.className)}
                      >
                        {col.cell(row, i)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Mobile: stacked cards */}
          <ul className="space-y-2.5 md:hidden" aria-label={typeof caption === "string" ? caption : undefined}>
            {visible.map((row, i) => (
              <li
                key={rowKey(row, i)}
                className={cn(
                  "rounded-card border bg-card p-4 text-table shadow-card",
                  onRowClick && "cursor-pointer active:bg-table-row-hover",
                )}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {titleCol ? <div className="mb-2.5 min-w-0 font-medium">{titleCol.cell(row, i)}</div> : null}
                {fieldCols.length > 0 ? (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
                    {fieldCols.map((col) => (
                      <React.Fragment key={col.id}>
                        <dt className="text-table-head font-semibold uppercase tracking-wider text-muted-foreground">
                          {col.header}
                        </dt>
                        <dd className="min-w-0 text-right break-words">{col.cell(row, i)}</dd>
                      </React.Fragment>
                    ))}
                  </dl>
                ) : null}
                {actionCols.length > 0 ? (
                  <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-table-border pt-3">
                    {actionCols.map((col) => (
                      <React.Fragment key={col.id}>{col.cell(row, i)}</React.Fragment>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}

      {pageSize && sorted.length > pageSize ? (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, sorted.length)} of {sorted.length}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => setPage(currentPage - 1)}
              disabled={currentPage === 0}
              aria-label="Previous page"
            >
              <ChevronLeft />
            </Button>
            <span className="px-2 tabular-nums">
              {currentPage + 1} / {pageCount}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => setPage(currentPage + 1)}
              disabled={currentPage >= pageCount - 1}
              aria-label="Next page"
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
