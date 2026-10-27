import { createContext, useContext, type ReactNode } from "react";

type Contexto<T extends string> = {
  value?: T;
  onValueChange?: (value: T) => void;
  disabled?: boolean;
};

const SelectContext = createContext<Contexto<string>>({});

export function Select<T extends string>({
  value,
  onValueChange,
  disabled,
  children,
}: {
  value?: T;
  onValueChange?: (value: T) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <SelectContext.Provider value={{ value, onValueChange: onValueChange as ((value: string) => void) | undefined, disabled }}>
      <div>{children}</div>
    </SelectContext.Provider>
  );
}

export function SelectTrigger({ children }: { children?: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}

export function SelectValue({ placeholder }: { placeholder?: string }) {
  return <span className="sr-only">{placeholder}</span>;
}

export function SelectContent({ children }: { children: ReactNode }) {
  const ctx = useContext(SelectContext);
  return (
    <select
      className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm disabled:bg-muted"
      disabled={ctx.disabled}
      value={ctx.value ?? ""}
      onChange={(event) => ctx.onValueChange?.(event.target.value)}
    >
      {ctx.value ? null : <option value="">Escolha</option>}
      {children}
    </select>
  );
}

export function SelectItem({ value, children }: { value: string; children: ReactNode }) {
  return <option value={value}>{children}</option>;
}
