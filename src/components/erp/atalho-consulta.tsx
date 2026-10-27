import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export const ATALHO_CONSULTA = "Consulta de títulos a receber";

export function AtalhoConsulta() {
  return (
    <Button variant="outline" asChild>
      <Link to="/contas/consulta">{ATALHO_CONSULTA}</Link>
    </Button>
  );
}
