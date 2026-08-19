import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary/10 text-primary",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        success: "border-transparent bg-success/10 text-success",
        // Warning / highlight — uses the logo-orange accent. Reserve for
        // pending states, "new" ribbons, upgrade prompts, etc.
        warning: "border-transparent bg-brand-orange/15 text-brand-orange",
        // Growth / brand-green accent — verified, live, positive-trend labels.
        brand: "border-transparent bg-brand-green/15 text-brand-green",
        destructive: "border-transparent bg-destructive/10 text-destructive",
        outline: "text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
export { badgeVariants };
