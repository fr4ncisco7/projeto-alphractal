import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { AnalysisPage } from "./pages/AnalysisPage";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { PredictionsPage } from "./pages/PredictionsPage";
import { GuestRoute, ProtectedRoute } from "./routes/RouteGuards";

export default function App() {
  return (
    <Routes>
      <Route element={<GuestRoute />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="analise" element={<AnalysisPage />} />
          <Route path="predicoes" element={<PredictionsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
