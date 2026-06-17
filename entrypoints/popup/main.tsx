import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../src/ui/tailwind.css";
import "../../src/ui/base.css";
import { App } from "./App";

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
