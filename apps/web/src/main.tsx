import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { registerServiceWorker } from "./lib/push";
import { isStandalone } from "./lib/viewport";
import "./styles/tokens.css";
import "./styles/base.css";

registerServiceWorker();
// Installed home-screen app: enables the status bar strip (base.css, "Status bar")
if (isStandalone()) document.documentElement.dataset.standalone = "";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
