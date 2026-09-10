import React, { Suspense, lazy } from "react";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";

// Componentes fijos
import Layout from "./components/Layout";
import Loader from './components/Loader';
import RequireAuth from "./components/RequireAuth";
import { initialAuthSearch, initialAuthHash } from "./lib/supabaseClient";

// Usamos lazy para las páginas. Esto permite que el Loader se active al navegar.
const Login = lazy(() => import("./pages/Login"));
const Home = lazy(() => import("./pages/Home"));
const Schedule = lazy(() => import("./pages/Schedule"));
const Notifications = lazy(() => import("./pages/Notifications"));
const OneOnOnes = lazy(() => import("./pages/OneOnOnes"));
const InfoHub = lazy(() => import("./pages/InfoHub"));
const People = lazy(() => import("./pages/People"));
const PersonDetail = lazy(() => import("./pages/PersonDetail"));
const Startups = lazy(() => import("./pages/Startups"));
const StartupDetail = lazy(() => import("./pages/StartupDetail"));
const ScheduleFeedback = lazy(() => import("./pages/ScheduleFeedback"));
const Logistics = lazy(() => import("./pages/Logistics"));
const MediaKit = lazy(() => import("./pages/MediaKit"));
const Campaigns = lazy(() => import("./pages/Campaigns"));
const TeamNotes = lazy(() => import("./pages/TeamNotes"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));

// Un pequeño componente para centrar el loader en pantalla completa
const LoadingScreen = () => (
  <div className="flex h-dvh w-full items-center justify-center bg-white">
    <Loader size={120} />
  </div>
);

const router = createBrowserRouter([
  {
    path: "/login",
    element: (
      <Suspense fallback={<LoadingScreen />}>
        <Login />
      </Suspense>
    ),
  },
  {
    path: "/reset-password",
    element: (
      <Suspense fallback={<LoadingScreen />}>
        <ResetPassword />
      </Suspense>
    ),
  },
  {
    path: "/",
    element: (() => {
      // Forward auth codes/recovery hashes to reset-password instead of dropping them
      const hasCode = new URLSearchParams(initialAuthSearch).has("code");
      const hasRecoveryHash = initialAuthHash.includes("type=recovery");
      if (hasCode || hasRecoveryHash) {
        return <Navigate to={`/reset-password${initialAuthSearch}${initialAuthHash}`} replace />;
      }
      // Keep the query string (e.g. ?match=<id> from a push click) across the redirect.
      return <Navigate to={`/home${initialAuthSearch}`} replace />;
    })(),
  },
  {
    element: (
      /* El Suspense aquí atrapa a cualquier página hija que esté cargando */
      <Suspense fallback={<LoadingScreen />}>
        <RequireAuth>
          <Layout />
        </RequireAuth>
      </Suspense>
    ),
    children: [
      { path: "/home", element: <Home /> },
      { path: "/schedule", element: <Schedule /> },
      { path: "/schedule/feedback/:day", element: <ScheduleFeedback /> },
      { path: "/notifications", element: <Notifications /> },
      { path: "/one-on-ones", element: <OneOnOnes /> },
      { path: "/info", element: <InfoHub /> },
      { path: "/people", element: <People /> },
      { path: "/person/:id", element: <PersonDetail /> },
      { path: "/startups", element: <Startups /> },
      { path: "/startup/:id", element: <StartupDetail /> },
      { path: "/logistics", element: <Logistics /> },
      { path: "/media-kit", element: <MediaKit /> },
      { path: "/campaigns", element: <Campaigns /> },
      { path: "/team-notes", element: <TeamNotes /> },
      { path: "*", element: <Navigate to="/home" replace /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}