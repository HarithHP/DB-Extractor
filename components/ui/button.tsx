import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const buttonVariants = cva(
  [
    "relative inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--btn-radius)] font-medium tracking-[-0.005em]",
    "transition-[background-color,color,box-shadow,transform,border-color,filter] duration-150 active:scale-[0.98]",
    "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
    "disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        default:
          "bg-primary bg-[image:var(--gradient-primary)] text-primary-foreground shadow-sm shadow-primary/25 hover:shadow-md hover:shadow-primary/30 hover:brightness-105",
        soft: "bg-primary/10 text-primary hover:bg-primary/15",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/70",
        outline: "border border-border bg-card text-foreground shadow-xs hover:border-primary/40 hover:bg-accent hover:text-accent-foreground",
        ghost: "text-foreground hover:bg-muted",
        destructive: "bg-destructive text-destructive-foreground shadow-sm shadow-destructive/25 hover:bg-destructive/90",
        "destructive-soft": "bg-destructive/10 text-destructive hover:bg-destructive/15",
        success: "bg-success text-success-foreground shadow-sm shadow-success/25 hover:bg-success/90",
        link: "h-auto px-0 text-primary underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        sm: "h-[var(--btn-height-sm)] px-2.5 text-btn-sm [&_svg]:size-3.5",
        md: "h-[var(--btn-height-md)] px-3.5 text-btn-md [&_svg]:size-[0.95rem]",
        lg: "h-[var(--btn-height-lg)] px-5 text-btn-lg [&_svg]:size-4",
        icon: "size-[var(--btn-height-md)] text-btn-md [&_svg]:size-[0.95rem]",
        "icon-sm": "size-[var(--btn-height-sm)] text-btn-sm [&_svg]:size-3.5",
      },
      fullWidth: { true: "w-full" },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>;

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Shows a spinner in place of the leading icon and disables the button. */
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export function Button({
  className,
  variant,
  size,
  fullWidth,
  asChild = false,
  loading = false,
  leftIcon,
  rightIcon,
  disabled,
  children,
  type,
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size, fullWidth }), className);

  if (asChild) {
    return (
      <Slot className={classes} {...props}>
        {children}
      </Slot>
    );
  }

  return (
    <button
      type={type ?? "button"}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin" aria-hidden /> : leftIcon}
      {children}
      {rightIcon}
    </button>
  );
}

export { buttonVariants };
