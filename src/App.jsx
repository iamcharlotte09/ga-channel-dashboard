import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import TopNav from "./components/TopNav";
import GADashboardPage from "./components/GADashboardPage";
import InsurerPerformancePage from "./components/InsurerPerformancePage";

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <TopNav currentPath={location.pathname} navigateTo={navigate} />

      <main className="mx-auto max-w-7xl px-4 pb-5 pt-4 sm:px-6 sm:pb-8 sm:pt-5">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<GADashboardPage />} />
          <Route path="/insurers" element={<InsurerPerformancePage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  );
}
