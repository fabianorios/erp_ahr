import { cloneElement, isValidElement, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm";
  asChild?: boolean;
  children?: ReactNode;
};

const variantes = {
  default: "bg-primary text-primary-foreground shadow hover:bg-primary/90",
  outline: "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
  ghost: "hover:bg-accent hover:text-accent-foreground",
};

const tamanhos = {
  default: "h-9 px-4 py-2 text-sm",
  sm: "h-8 rounded-md px-3 text-xs",
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
