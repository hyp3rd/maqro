import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search } from "lucide-react";

/** Consistent toolbar for every admin grid: an optional search
 *  input, one-or-more filter Selects, and a trailing slot (usually
 *  the result count or a refresh button).
 *
 *  Why a primitive: each admin grid was open-coding its own
 *  search-and-filter row with slightly different spacing,
 *  placeholder copy, and disabled-state behaviour. Centralizing
 *  forces consistency and makes future tweaks (keyboard shortcut
 *  on `/`, debounced search, persisted filters) one-file changes
 *  instead of three. */

export type FilterDef = {
  /** Name passed back to the parent's `onChange` so a single
   *  handler can dispatch on which filter moved. */
  name: string;
  /** Label shown above / inside the trigger. We render below the
   *  visible width on mobile, so a 1-2 word label is best. */
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (next: string) => void;
};

export function AdminToolbar({
  search,
  filters,
  trailing,
}: {
  search?: {
    value: string;
    onChange: (next: string) => void;
    placeholder?: string;
  };
  filters?: FilterDef[];
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      {search && (
        <div className="relative max-w-sm flex-1">
          <Search
            className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            placeholder={search.placeholder ?? "Search…"}
            className="pl-8"
          />
        </div>
      )}

      {filters?.map((f) => (
        <div
          key={f.name}
          className="flex items-center gap-1.5"
        >
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {f.label}
          </span>
          <Select
            value={f.value}
            onValueChange={f.onChange}
          >
            <SelectTrigger className="h-8 w-[160px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {f.options.map((opt) => (
                <SelectItem
                  key={opt.value}
                  value={opt.value}
                  className="text-xs"
                >
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}

      {trailing && <div className="sm:ml-auto">{trailing}</div>}
    </div>
  );
}
