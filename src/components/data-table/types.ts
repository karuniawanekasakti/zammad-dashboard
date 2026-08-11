export const EMPTY_VALUE = "__empty__";

export type DataTableFilterOperator = "contains" | "equals";
export type DataTableFilterVariant = "text" | "select";

export interface DataTableOption {
  label: string;
  value: string;
}

export interface DataTableFilterField<TData> {
  id: Extract<keyof TData, string> | string;
  label: string;
  variant: DataTableFilterVariant;
  options?: DataTableOption[];
}

export interface DataTableFilter {
  id: string;
  field: string;
  operator: DataTableFilterOperator;
  value: string;
}

export interface DataTableSort {
  id: string;
  field: string;
  desc: boolean;
}
