import { Navigate, Route, Routes } from "react-router-dom";
import { Abertura } from "./components/Abertura";
import { AppShell } from "./components/AppShell";
import { AnalysisPage } from "./pages/AnalysisPage";
import { HomePage } from "./pages/HomePage";
import { LandingPage } from "./pages/LandingPage";
import { PredictionsPage } from "./pages/PredictionsPage";

/**
 * Duas entradas, com exigências opostas.
 *
 * `/` é a apresentação do projeto: conteúdo estático, que precisa abrir mesmo
 * com a stack desligada -- é a página que alguém abre para entender o que é
 * isto antes de subir contêiner nenhum. Por isso fica FORA da `Abertura`.
 *
 * `/painel/*` é o produto, e aí a `Abertura` faz sentido: ela verifica banco,
 * ingestão e solver antes de deixar o painel aparecer com caixas de erro.
 *
 * Não há rota de login: a autenticação é da plataforma da Alphractal, e quem
 * chega ao módulo já passou por ela (decisão 30).
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />

      <Route
        path="/painel"
        element={
          <Abertura>
            <AppShell />
          </Abertura>
        }
      >
        <Route index element={<HomePage />} />
        <Route path="analise" element={<AnalysisPage />} />
        <Route path="predicoes" element={<PredictionsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
