import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import PruebasPage from "./pages/PruebasPage";
import PlantillasPage from "./pages/PlantillasPage";
import ChecklistPage from "./pages/ChecklistPage";
import FotograficoPage from "./pages/FotograficoPage";
import PoderJudicialPage from "./pages/PoderJudicialPage";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/pruebas" replace />} />
        <Route path="/pruebas" element={<PruebasPage />} />
        <Route path="/plantillas" element={<PlantillasPage />} />
        <Route path="/checklist" element={<ChecklistPage />} />
        <Route path="/fotografico" element={<Navigate to="/fotografico/fibra" replace />} />
        <Route path="/fotografico/gpon-ont" element={<FotograficoPage tipo="gpon_ont" />} />
        <Route path="/fotografico/gpon-modulo" element={<FotograficoPage tipo="gpon_modulo" />} />
        <Route path="/fotografico/fibra" element={<FotograficoPage tipo="fibra" />} />
        <Route path="/fotografico/poder-judicial" element={<PoderJudicialPage />} />
      </Route>
    </Routes>
  );
}
