import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export const ATALHO_CONSULTA = "Contas a receber";

export function AtalhoConsulta() {
  return (
    <Button variant="outline" asChild>
      <Link to="/contas">{ATALHO_CONSULTA}</Link>
    </Button>
  );
}
