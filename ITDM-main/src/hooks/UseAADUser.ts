import { useMsal, useAccount } from "@azure/msal-react";

export function useAADUser() {
  const { accounts, instance } = useMsal();
  const primary = accounts[0];
  const account = useAccount(primary || undefined);

  // MSAL AccountInfo often has what we need directly:
  // - account?.name (display name)
  // - account?.username (UPN/email-like)
  const claims = (account?.idTokenClaims ?? {}) as Record<string, any>;

  const name =
    account?.name ||                                   // best source
    (claims.name as string) ||                         // standard OIDC "name"
    (claims.given_name && claims.family_name
      ? `${claims.given_name} ${claims.family_name}`
      : undefined) ||
    (account?.username as string) ||                   // MSAL’s username
    (claims.preferred_username as string) ||           // AAD
    (claims.upn as string) ||                          // AAD (sometimes)
    (claims.email as string) ||                        // some tenants
    "Unknown User";

  const email =
    (account?.username as string) ||                   // usually UPN/email
    (claims.preferred_username as string) ||
    (claims.email as string) ||
    (claims.upn as string) ||
    "";

  const isAuthenticated = !!account;

  const signIn = () =>
    instance.loginRedirect({
      scopes: ["openid", "profile", "email"], // later add "User.Read" if you call Graph
    });

  const signOut = () =>
    instance.logoutRedirect({ postLogoutRedirectUri: window.location.origin });

  // Optional: uncomment to debug what we actually have
  // console.log({ isAuthenticated, account, claims, name, email });

  return { name, email, claims, isAuthenticated, signIn, signOut };
}
