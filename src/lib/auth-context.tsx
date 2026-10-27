import { createContext, useContext, type ReactNode } from "react";

export type SessaoErp = { canEdit: boolean; email: string };

const AuthContext = createContext<SessaoErp>({ canEdit: false, email: "" });

export function AuthProvider({ value, children }: { value: SessaoErp; children: ReactNode }) {
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): SessaoErp {
  return useContext(AuthContext);
}
