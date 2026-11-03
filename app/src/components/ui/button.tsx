import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// shadcn/ui Button (new-york), without `asChild` so it needs no Radix yet. The focus ring
// comes from the global `:focus-visible` rule in index.css (2px primary).
// Disabled buttons keep pointer events so their `title` tooltip still shows (like File
// Explorer's disabled Back); hover colors apply only while enabled.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-body-sm font-medium disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground enabled:hover:bg-primary/90",
        // shadcn's dark treatment: white text on the light dark-mode red needs the 60% fill.
        destructive: "bg-destructive text-white enabled:hover:bg-destructive/90 dark:bg-destructive/60",
        secondary: "bg-secondary text-secondary-foreground enabled:hover:bg-secondary/80",
        ghost: "enabled:hover:bg-accent enabled:hover:text-accent-foreground",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3",
        icon: "size-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({
  className,
  variant,
  size,
  type = "button",
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return <button type={type} className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
