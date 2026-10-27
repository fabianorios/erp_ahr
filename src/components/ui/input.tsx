import type { InputHTMLAttributes } from "react";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-md border border-input bg-card px-3 py-2 text-sm disabled:bg-muted ${props.className ?? ""}`}
    />
  );
}
