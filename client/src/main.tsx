import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
// Fonts are bundled with the site (the security policy only allows the app's own address).
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/public-sans";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
