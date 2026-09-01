import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { SplashScreen } from "../components/SplashScreen";

/** Bloqueia o app para quem não está autenticado. */
export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") return <SplashScreen />;

  if (status === "guest") {
    return (
      <Navigate to="/login" replace state={{ from: location.pathname }} />
    );
  }

  return <Outlet />;
}

/** Mantém quem já entrou fora da tela de login. */
export function GuestRoute() {
  const { status } = useAuth();

  if (status === "loading") return <SplashScreen />;
  if (status === "authenticated") return <Navigate to="/" replace />;

  return <Outlet />;
}
