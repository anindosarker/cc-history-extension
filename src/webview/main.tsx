import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { UsageApp } from "./UsageApp";
import "./styles.css";

const root = document.getElementById("root");
if (root) {
  const view = document.body.dataset.view ?? "session";
  createRoot(root).render(<React.StrictMode>{view === "usage" ? <UsageApp /> : <App />}</React.StrictMode>);
}
