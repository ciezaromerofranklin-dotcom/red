import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import Spinner from "./components/Spinner";
import { useAuth } from "./auth/AuthContext";
import LoginPage from "./pages/LoginPage";
import PlantillasPage from "./pages/PlantillasPage";
import ChecklistPage from "./pages/ChecklistPage";
import FotograficoPage from "./pages/FotograficoPage";
import PoderJudicialPage from "./pages/PoderJudicialPage";
import ClientsPage from "./pages/ClientsPage";
import AdminUsersPage from "./pages/AdminUsersPage";

export default function App() {
  const { user, loading, isAdmin } = useAuth();

  if (loading) {
    return <div className="min-h-[100dvh] flex items-center justify-center text-slate-500"><Spinner /> Cargando...</div>;
  }
  if (!user) return <LoginPage />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/checklist" replace />} />
        <Route path="/plantillas" element={<PlantillasPage />} />
        <Route path="/checklist" element={<ChecklistPage />} />
        <Route path="/mis-clientes" element={<ClientsPage />} />
        {isAdmin && <Route path="/admin/usuarios" element={<AdminUsersPage />} />}
        {isAdmin && <Route path="/admin/clientes" element={<ClientsPage admin />} />}
        <Route path="/fotografico" element={<Navigate to="/fotografico/fibra" replace />} />
        <Route path="/fotografico/gpon-ont" element={<FotograficoPage key="gpon_ont" tipo="gpon_ont" />} />
        <Route path="/fotografico/gpon-modulo" element={<FotograficoPage key="gpon_modulo" tipo="gpon_modulo" />} />
        <Route path="/fotografico/fibra" element={<FotograficoPage key="fibra" tipo="fibra" />} />
        <Route path="/fotografico/poder-judicial" element={<PoderJudicialPage />} />
        <Route path="*" element={<Navigate to="/checklist" replace />} />
      </Route>
    </Routes>
  );
}
