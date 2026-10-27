import type { ReactNode } from "react";

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-lg border border-border bg-card text-card-foreground ${className ?? ""}`}>{children}</div>;
}

export function CardContent({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={className}>{children}</div>;
}
