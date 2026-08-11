import { useEffect, useState } from "react";
import type { Table as TanstackTable } from "@tanstack/react-table";
import { Download, Filter, RotateCcw, Search, ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DataTableFilterList } from "./data-table-filter-list";
import { DataTableSortList } from "./data-table-sort-list";
import { DataTableViewOptions } from "./data-table-view-options";
import type { DataTableFilter, DataTableFilterField, DataTableSort } from "./types";

interface DataTableAdvancedToolbarProps<TData> {
  table: TanstackTable<TData>;
  search: string;
  onSearchChange: (value: string) => void;
  filterFields: DataTableFilterField<TData>[];
  filters: DataTableFilter[];
  onFiltersChange: (filters: DataTableFilter[]) => void;
  sortFields: DataTableFilterField<TData>[];
  sorts: DataTableSort[];
  onSortsChange: (sorts: DataTableSort[]) => void;
  onExport?: () => void;
  exportLabel?: string;
}

export function DataTableAdvancedToolbar<TData>({
  table,
  search,
  onSearchChange,
  filterFields,
  filters,
  onFiltersChange,
  sortFields,
  sorts,
  onSortsChange,
  onExport,
  exportLabel = "Export",
}: DataTableAdvancedToolbarProps<TData>) {
  const [inputValue, setInputValue] = useState(search);
  const isFiltered = search !== "" || filters.length > 0 || sorts.length > 0;

  useEffect(() => setInputValue(search), [search]);
  useEffect(() => {
    const timeout = window.setTimeout(() => onSearchChange(inputValue), 300);
    return () => window.clearTimeout(timeout);
  }, [inputValue, onSearchChange]);

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
      <div className="relative flex-1">
        <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input
          placeholder="Search by title, number, or customer…"
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          className="pl-8"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              <Filter className="size-4" />
              Filter
              {filters.length > 0 && <span className="ml-1 rounded bg-muted px-1.5 text-xs">{filters.length}</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[min(720px,calc(100vw-2rem))]">
            <DataTableFilterList fields={filterFields} filters={filters} onFiltersChange={onFiltersChange} />
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              <ArrowUpDown className="size-4" />
              Sort
              {sorts.length > 0 && <span className="ml-1 rounded bg-muted px-1.5 text-xs">{sorts.length}</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[min(520px,calc(100vw-2rem))]">
            <DataTableSortList fields={sortFields} sorts={sorts} onSortsChange={onSortsChange} />
          </PopoverContent>
        </Popover>

        {isFiltered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setInputValue("");
              onSearchChange("");
              onFiltersChange([]);
              onSortsChange([]);
            }}
          >
            <RotateCcw className="size-4" />
            Reset
          </Button>
        )}

        {onExport && (
          <Button variant="outline" size="sm" onClick={onExport}>
            <Download className="size-4" />
            {exportLabel}
          </Button>
        )}
        <DataTableViewOptions table={table} />
      </div>
    </div>
  );
}
