import { useAADUser } from "./hooks/useAADUser";

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, signIn } = useAADUser();
  if (!isAuthenticated) {
    return (
      <div className="text-sm">
        You must sign in to use this feature.{" "}
        <button className="underline" onClick={signIn}>Sign in</button>
      </div>
    );
  }
  return <>{children}</>;
}
