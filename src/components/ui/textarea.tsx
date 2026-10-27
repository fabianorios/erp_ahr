import type { TextareaHTMLAttributes } from "react";

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`min-h-24 w-full rounded-md border border-input bg-card px-3 py-2 text-sm disabled:bg-muted ${props.className ?? ""}`}
    />
  );
}
