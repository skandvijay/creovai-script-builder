import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

const rootEl = document.getElementById("root");

if (typeof document !== "undefined") {
  document.documentElement.style.background = "#f5f5f7";
  document.body.style.margin = "0";
  document.body.style.background = "#f5f5f7";
  document.body.style.fontFamily =
    "-apple-system, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif";
  document.body.style.webkitFontSmoothing = "antialiased";
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
