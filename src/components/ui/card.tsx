import type { ReactNode } from "react";

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-xl border bg-card text-card-foreground shadow ${className ?? ""}`}>{children}</div>;
}

export function CardContent({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={`px-6 ${className ?? ""}`}>{children}</div>;
}
