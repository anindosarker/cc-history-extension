import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        "flex h-7 w-full rounded-md border border-input-border bg-input px-2 py-1 text-[length:inherit] text-[color:var(--vscode-input-foreground)] placeholder:text-[color:var(--vscode-input-placeholderForeground)] focus-visible:outline-none focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export { Input };
