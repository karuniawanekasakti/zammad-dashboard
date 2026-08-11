import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EMPTY_VALUE, type DataTableFilter, type DataTableFilterField } from "./types";

interface DataTableFilterListProps<TData> {
  fields: DataTableFilterField<TData>[];
  filters: DataTableFilter[];
  onFiltersChange: (filters: DataTableFilter[]) => void;
}

const OPERATORS = [
  { value: "contains", label: "contains" },
  { value: "equals", label: "equals" },
] as const;

function id() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;
}

export function DataTableFilterList<TData>({ fields, filters, onFiltersChange }: DataTableFilterListProps<TData>) {
  const updateFilter = (filterId: string, patch: Partial<DataTableFilter>) => {
    onFiltersChange(filters.map((filter) => (filter.id === filterId ? { ...filter, ...patch } : filter)));
  };

  const addFilter = () => {
    const field = fields[0];
    if (!field) return;
    onFiltersChange([
      ...filters,
      {
        id: id(),
        field: field.id,
        operator: field.variant === "select" ? "equals" : "contains",
        value: field.options?.[0]?.value ?? "",
      },
    ]);
  };

  return (
    <div className="space-y-3">
      {filters.length === 0 && <div className="text-sm text-muted-foreground">No filters added.</div>}
      {filters.map((filter) => {
        const field = fields.find((item) => item.id === filter.field) ?? fields[0];
        return (
          <div key={filter.id} className="grid gap-2 sm:grid-cols-[1fr_110px_1fr_auto]">
            <Select
              value={filter.field}
              onValueChange={(value) => {
                const nextField = fields.find((item) => item.id === value);
                updateFilter(filter.id, {
                  field: value,
                  operator: nextField?.variant === "select" ? "equals" : "contains",
                  value: nextField?.options?.[0]?.value ?? "",
                });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {fields.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filter.operator}
              onValueChange={(value) => updateFilter(filter.id, { operator: value as DataTableFilter["operator"] })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPERATORS.map((operator) => (
                  <SelectItem key={operator.value} value={operator.value}>
                    {operator.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {field?.variant === "select" ? (
              <Select value={filter.value || EMPTY_VALUE} onValueChange={(value) => updateFilter(filter.id, { value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Value" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={EMPTY_VALUE}>Blank</SelectItem>
                  {(field.options ?? []).map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={filter.value === EMPTY_VALUE ? "" : filter.value}
                onChange={(event) => updateFilter(filter.id, { value: event.target.value })}
                placeholder="Value"
              />
            )}

            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onFiltersChange(filters.filter((item) => item.id !== filter.id))}
              aria-label="Remove filter"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        );
      })}
      <Button type="button" variant="outline" size="sm" onClick={addFilter} disabled={fields.length === 0}>
        <Plus className="size-4" />
        Add filter
      </Button>
    </div>
  );
}
