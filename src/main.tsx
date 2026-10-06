import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./network.css";

function initialTheme() {
  try {
    return localStorage.getItem("workbox.theme") || "system";
  } catch {
    return "system";
  }
}
const theme = initialTheme();
document.documentElement.dataset.theme =
  theme === "dark" ||
  (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
    ? "dark"
    : "light";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
