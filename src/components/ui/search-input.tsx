import * as React from "react";
import { Search, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

interface SearchInputProps extends Omit<
  React.ComponentProps<"input">,
  "type" | "onChange"
> {
  containerClassName?: string;
  inputClassName?: string;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  onValueChange?: (value: string) => void;
  onClear?: () => void;
  clearLabel?: string;
}

const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  (
    {
      className,
      containerClassName,
      inputClassName,
      value,
      onChange,
      onValueChange,
      onClear,
      placeholder = "Search...",
      clearLabel = "Clear search",
      ...props
    },
    ref,
  ) => {
    const hasValue = typeof value === "string" && value.length > 0;

    function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
      onChange?.(event);
      onValueChange?.(event.target.value);
    }

    return (
      <div
        className={cn(
          "relative min-w-0 flex-1 max-w-[200px] sm:max-w-xs",
          containerClassName,
          className,
        )}
      >
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary" />
        <Input
          ref={ref}
          type="search"
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          className={cn("h-8 pl-8 pr-8 text-[12.5px]", inputClassName)}
          {...props}
        />
        {hasValue && onClear && (
          <button
            type="button"
            onClick={onClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-text-tertiary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
            aria-label={clearLabel}
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    );
  },
);
SearchInput.displayName = "SearchInput";

export { SearchInput };
