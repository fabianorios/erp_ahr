import type { ReactNode } from "react";

export function Label({ children }: { children: ReactNode }) {
  return <span className="text-sm font-medium">{children}</span>;
}
