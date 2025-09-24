/*
import "./index.css";
import React from "react";
import ReactDOM from "react-dom/client";
import DemandManagementSystem from "./apex_demand_management";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DemandManagementSystem />
  </React.StrictMode>
);
*/

// Wrap app with MsalProvider and bootstrap MSAL
import "./index.css";
import React from "react";
import ReactDOM from "react-dom/client";
import DemandManagementSystem from "./apex_demand_management";

import { PublicClientApplication } from "@azure/msal-browser";
import { MsalProvider } from "@azure/msal-react";

const msalInstance = new PublicClientApplication({
  auth: {
    clientId: import.meta.env.VITE_AAD_CLIENT_ID!,
    authority: `https://login.microsoftonline.com/${import.meta.env.VITE_AAD_TENANT_ID}`,
    redirectUri: import.meta.env.VITE_AAD_REDIRECT_URI || window.location.origin,  // ← use env
  },
  cache: { cacheLocation: "localStorage", storeAuthStateInCookie: true },
});

// Add global error logging
msalInstance.addEventCallback((e) => {
  if (e.eventType === "msal:loginFailure" || e.eventType === "msal:acquireTokenFailure") {
    console.error("MSAL error:", e.error);
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MsalProvider instance={msalInstance}>
      <DemandManagementSystem />
    </MsalProvider>
  </React.StrictMode>
);

