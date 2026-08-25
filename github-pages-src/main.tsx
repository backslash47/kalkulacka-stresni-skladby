import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import RoofCalculator from "../app/roof-calculator";
import "../app/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RoofCalculator />
  </StrictMode>,
);
