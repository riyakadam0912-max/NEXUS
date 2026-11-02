import { Slot } from "@radix-ui/react-slot";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm";
  asChild?: boolean;
};

const variants = {
  default: "bg-violet-500 text-white hover:bg-violet-400 disabled:opacity-40",
  outline: "border border-white/10 text-slate-300 hover:bg-white/[.04] disabled:opacity-40",
  ghost: "text-slate-300 hover:bg-white/[.05] disabled:opacity-40",
};

const sizes = {
  default: "h-10 px-4",
  sm: "h-8 px-3",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", asChild = false, ...props }, ref) => {
    const Component = asChild ? Slot : "button";
    return (
      <Component
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-lg text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70 disabled:pointer-events-none disabled:cursor-not-allowed",
          variants[variant],
          sizes[size],
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
