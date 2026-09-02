import { Navigate, Route, Routes } from "react-router-dom";
import { Abertura } from "./components/Abertura";
import { AppShell } from "./components/AppShell";
import { AnalysisPage } from "./pages/AnalysisPage";
import { HomePage } from "./pages/HomePage";
import { PredictionsPage } from "./pages/PredictionsPage";

/**
 * Não há rota de login nem guarda de rota.
 *
 * O Fees Monitor é um módulo da aba "Fees" da plataforma da Alphractal: a
 * autenticação é da plataforma, e quem chega até aqui já passou por ela. Uma
 * tela de login própria seria uma cerimônia sem backend por trás -- o serviço
 * de gas expõe dado público, sem usuário nem sessão. No lugar dela, a
 * `Abertura` verifica se o sistema tem o que precisa para abrir.
 */
export default function App() {
  return (
    <Abertura>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="analise" element={<AnalysisPage />} />
          <Route path="predicoes" element={<PredictionsPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Abertura>
  );
}
