"use client";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";

export type SortDir = "asc" | "desc";
export type SortState<K extends string> = { key: K; dir: SortDir } | null;

export default function SortableTh<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: K;
  sort: SortState<K>;
  onSort: (key: K) => void;
}) {
  const active = sort?.key === sortKey;
  return (
    <th className="pb-3">
      <button
        onClick={() => onSort(sortKey)}
        className="flex items-center gap-1 hover:text-gray-200 transition-colors whitespace-nowrap"
      >
        {label}
        {active ? (
          sort!.dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />
        ) : (
          <ArrowUpDown size={12} className="text-gray-600" />
        )}
      </button>
    </th>
  );
}

export function toggleSort<K extends string>(
  current: SortState<K>,
  key: K
): SortState<K> {
  if (current?.key === key) {
    return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { key, dir: "desc" };
}

export function sortRows<T extends Record<string, any>, K extends string>(
  rows: T[],
  sort: SortState<K>,
  getValue: (row: T, key: K) => string | number | null | undefined
): T[] {
  if (!sort) return rows;
  return [...rows].sort((a, b) => {
    const va = getValue(a, sort.key);
    const vb = getValue(b, sort.key);
    if (va == null && vb == null) return 0;
    if (va == null) return sort.dir === "asc" ? -1 : 1;
    if (vb == null) return sort.dir === "asc" ? 1 : -1;
    if (typeof va === "string" || typeof vb === "string") {
      const cmp = String(va).localeCompare(String(vb));
      return sort.dir === "asc" ? cmp : -cmp;
    }
    return sort.dir === "asc" ? va - vb : vb - va;
  });
}
