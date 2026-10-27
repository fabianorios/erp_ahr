import { cloneElement, isValidElement, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm";
  asChild?: boolean;
  children?: ReactNode;
};

const variantes = {
  default: "bg-primary text-primary-foreground hover:opacity-90",
  outline: "border border-border bg-card hover:bg-secondary",
  ghost: "hover:bg-accent",
};

const tamanhos = {
  default: "px-3 py-2 text-sm",
  sm: "px-2 py-1 text-xs",
};

export function Button({ variant = "default", size = "default", asChild, className, children, ...props }: Props) {
  const classe = `inline-flex items-center justify-center rounded-md font-medium disabled:opacity-50 ${variantes[variant]} ${tamanhos[size]} ${className ?? ""}`;
  if (asChild && isValidElement(children)) {
    const filho = children as ReactElement<{ className?: string }>;
    return cloneElement(filho, { className: `${classe} ${filho.props.className ?? ""}` });
  }
  return (
    <button className={classe} {...props}>
      {children}
    </button>
  );
}
