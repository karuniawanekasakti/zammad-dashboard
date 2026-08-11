import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DataTableFilterField, DataTableSort } from "./types";

interface DataTableSortListProps<TData> {
  fields: DataTableFilterField<TData>[];
  sorts: DataTableSort[];
  onSortsChange: (sorts: DataTableSort[]) => void;
}

function id() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;
}

export function DataTableSortList<TData>({ fields, sorts, onSortsChange }: DataTableSortListProps<TData>) {
  const updateSort = (sortId: string, patch: Partial<DataTableSort>) => {
    onSortsChange(sorts.map((sort) => (sort.id === sortId ? { ...sort, ...patch } : sort)));
  };

  const addSort = () => {
    const field = fields.find((item) => !sorts.some((sort) => sort.field === item.id));
    if (!field) return;
    onSortsChange([...sorts, { id: id(), field: field.id, desc: false }]);
  };

  return (
    <div className="space-y-3">
      {sorts.length === 0 && <div className="text-sm text-muted-foreground">No sorting added.</div>}
      {sorts.map((sort) => (
        <div key={sort.id} className="grid gap-2 sm:grid-cols-[1fr_120px_auto]">
          <Select value={sort.field} onValueChange={(value) => updateSort(sort.id, { field: value })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {fields.map((field) => (
                <SelectItem key={field.id} value={field.id} disabled={sorts.some((item) => item.id !== sort.id && item.field === field.id)}>
                  {field.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sort.desc ? "desc" : "asc"} onValueChange={(value) => updateSort(sort.id, { desc: value === "desc" })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="asc">Asc</SelectItem>
              <SelectItem value="desc">Desc</SelectItem>
            </SelectContent>
          </Select>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onSortsChange(sorts.filter((item) => item.id !== sort.id))}
            aria-label="Remove sort"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={addSort} disabled={fields.length === sorts.length}>
        <Plus className="size-4" />
        Add sort
      </Button>
    </div>
  );
}
