Azure AD (MSAL) - Use the signed-in user’s displayName / email from the ID token.

1) Install deps
npm i @azure/msal-browser @azure/msal-react

2) Update main.tsx

Wrap your app with MsalProvider and bootstrap MSAL:

// main.tsx
import "./index.css";
import React from "react";
import ReactDOM from "react-dom/client";
import DemandManagementSystem from "./apex_demand_management";

import { PublicClientApplication } from "@azure/msal-browser";
import { MsalProvider } from "@azure/msal-react";

const msalInstance = new PublicClientApplication({
  auth: {
    clientId: import.meta.env.VITE_AAD_CLIENT_ID!,                         // REQUIRED
    authority: `https://login.microsoftonline.com/${import.meta.env.VITE_AAD_TENANT_ID}`, // REQUIRED
    redirectUri: window.location.origin,                                    // match App Registration redirect URI
  },
  cache: { cacheLocation: "localStorage", storeAuthStateInCookie: true },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MsalProvider instance={msalInstance}>
      <DemandManagementSystem />
    </MsalProvider>
  </React.StrictMode>
);

3) Add a tiny hook to read the signed-in user

Create src/hooks/useAADUser.ts:

import { useMsal, useAccount } from "@azure/msal-react";

export function useAADUser() {
  const { accounts, instance } = useMsal();
  const account = useAccount(accounts[0] || undefined);

  const claims = (account?.idTokenClaims ?? {}) as Record<string, any>;

  const name =
    (claims.name as string) ??
    ((claims.given_name && claims.family_name)
      ? `${claims.given_name} ${claims.family_name}`
      : undefined) ??
    (claims.preferred_username as string) ??
    "Unknown User";

  const email =
    (claims.preferred_username as string) ??
    (claims.email as string) ??
    (claims.upn as string) ??
    "";

  const signIn = () =>
    instance.loginRedirect({
      scopes: ["openid", "profile", "email"], // add API scopes later if needed
    });

  const signOut = () =>
    instance.logoutRedirect({ postLogoutRedirectUri: window.location.origin });

  const isAuthenticated = !!account;

  return { name, email, claims, isAuthenticated, signIn, signOut };
}

4) Use it in your component

In apex_demand_management.tsx, replace the hardcoded “John Smith”.

Before

const [currentUserName] = useState("John Smith");


After

import { useAADUser } from "./hooks/useAADUser";

// ...
const { name: currentUserName, email: currentUserEmail, isAuthenticated, signIn, signOut } = useAADUser();
const safeUserName = currentUserName || import.meta.env.VITE_DEV_USER_NAME || "Unknown User";


Update the header and payloads:

<div className="flex items-center space-x-4">
  <div className="text-sm text-gray-600">
    {isAuthenticated ? <>Welcome, {safeUserName}</> : <>Not signed in</>}
  </div>

  {!isAuthenticated ? (
    <button onClick={signIn} className="px-2 py-1 text-sm bg-blue-600 text-white rounded">Sign in</button>
  ) : (
    <button onClick={signOut} className="px-2 py-1 text-sm bg-gray-200 rounded">Sign out</button>
  )}

  {/* keep role switcher */}
  <select /* ... */>…</select>
</div>


And when creating/submitting a demand, swap:

requestor: safeUserName,
requestor_email: currentUserEmail, // (optional) add this column/field if you want

5) Environment variables (Vite)

Create .env.local:

VITE_AAD_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
VITE_AAD_TENANT_ID=yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy
VITE_DEV_USER_NAME=Maz  # optional local fallback

6) Azure app registration checklist (once)

App type: “Single-page application”.

Redirect URI: https://your-domain/ and http://localhost:5173/ (dev).

Expose nothing else for now (just openid, profile, email).

If you’ll call a protected API later, add scopes and use acquireTokenSilent.

7) Important backend note (security)

Even though the UI shows the user, don’t trust requestor from the client. On the API:

Validate the JWT (Entra ID).

Read name/email/oid from the token.

Override requestor before inserting into DB.

That’s it. After these changes, your “Demand Requestor” will resolve dynamically from the logged-in Entra ID user. If you want, I can also add a small AuthGuard wrapper so the Submit tab is only visible when authenticated.