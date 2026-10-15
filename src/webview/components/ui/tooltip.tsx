import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

interface TooltipContentProps extends React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content> {
  /** False renders the content in place instead of a portal, which also lets it show up in server output. */
  portal?: boolean;
}

const TooltipContent = React.forwardRef<React.ElementRef<typeof TooltipPrimitive.Content>, TooltipContentProps>(
  ({ className, sideOffset = 4, portal = true, ...props }, ref) => {
    const content = (
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          "z-50 max-w-[420px] overflow-hidden rounded-md border border-border bg-popover px-2 py-1 text-popover-foreground shadow-md break-words",
          className,
        )}
        {...props}
      />
    );
    return portal ? <TooltipPrimitive.Portal>{content}</TooltipPrimitive.Portal> : content;
  },
);
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
