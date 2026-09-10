import { Route, Routes } from "react-router-dom";
import Layout from "./components/layout";
import { ToastHost } from "./components/ui";
import Dashboard from "./pages/Dashboard";
import ImportPage from "./pages/Import";
import PatientsPage from "./pages/Patients";
import TrendsPage from "./pages/Trends";
import TemplatesPage from "./pages/Templates";

export default function App() {
  return (
    <>
      <ToastHost />
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/patients" element={<PatientsPage />} />
          <Route path="/trends" element={<TrendsPage />} />
          <Route path="/templates" element={<TemplatesPage />} />
        </Route>
      </Routes>
    </>
  );
}
