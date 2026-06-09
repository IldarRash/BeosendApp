import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ApiProvider } from "./api/ApiProvider";
import { RequireAuth } from "./auth/RequireAuth";
import { Analytics } from "./pages/Analytics";
import { Attendance } from "./pages/Attendance";
import { Broadcasts } from "./pages/Broadcasts";
import { Clients } from "./pages/Clients";
import { CourtBlocks } from "./pages/CourtBlocks";
import { CourtLoad } from "./pages/CourtLoad";
import { CourtRequests } from "./pages/CourtRequests";
import { Dashboard } from "./pages/Dashboard";
import { Groups } from "./pages/Groups";
import { Labels } from "./pages/Labels";
import { Levels } from "./pages/Levels";
import { Login } from "./pages/Login";
import { NotificationTemplates } from "./pages/NotificationTemplates";
import { Subscriptions } from "./pages/Subscriptions";
import { Trainers } from "./pages/Trainers";
import { Trainings } from "./pages/Trainings";
import { LanguageProvider } from "./i18n/LanguageProvider";
import { ToastProvider } from "./ui/Toast";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false }
  }
});

/**
 * App root: data layer (react-query) + the shared ApiClient + toasts + router.
 * /login is public; the dashboard sits behind RequireAuth. M1–M4 domain routes
 * land later; for now any unknown authed path falls back to the dashboard.
 */
export function App(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <ApiProvider>
        <LanguageProvider>
          <ToastProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route
                  path="/"
                  element={
                    <RequireAuth>
                      <Dashboard />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/groups"
                  element={
                    <RequireAuth>
                      <Groups />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/trainings"
                  element={
                    <RequireAuth>
                      <Trainings />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/trainers"
                  element={
                    <RequireAuth>
                      <Trainers />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/levels"
                  element={
                    <RequireAuth>
                      <Levels />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/attendance"
                  element={
                    <RequireAuth>
                      <Attendance />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/clients"
                  element={
                    <RequireAuth>
                      <Clients />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/subscriptions"
                  element={
                    <RequireAuth>
                      <Subscriptions />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/court-requests"
                  element={
                    <RequireAuth>
                      <CourtRequests />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/court-blocks"
                  element={
                    <RequireAuth>
                      <CourtBlocks />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/court-load"
                  element={
                    <RequireAuth>
                      <CourtLoad />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/broadcasts"
                  element={
                    <RequireAuth>
                      <Broadcasts />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/analytics"
                  element={
                    <RequireAuth>
                      <Analytics />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/labels"
                  element={
                    <RequireAuth>
                      <Labels />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/notification-templates"
                  element={
                    <RequireAuth>
                      <NotificationTemplates />
                    </RequireAuth>
                  }
                />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </BrowserRouter>
          </ToastProvider>
        </LanguageProvider>
      </ApiProvider>
    </QueryClientProvider>
  );
}
