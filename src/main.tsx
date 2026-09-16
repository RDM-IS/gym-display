import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import SessionBanner from "./components/SessionBanner";
import "./styles/base.css";
import "./styles/workout.css";
import "./styles/logger.css";
import "./styles/status-page.css";
import "./styles/flow.css";
import "./styles/week.css";
import "./styles/status2.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

createRoot(root).render(
  <StrictMode>
    <SessionBanner />
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
