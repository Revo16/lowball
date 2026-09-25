import { redirect } from "next/navigation";
import { ActionForm, Submit } from "@/components/client";
import { AppBar } from "@/components/ui";
import { signIn } from "@/app/actions";
import { members } from "@/lib/sleeper";
import { currentUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await currentUserId()) redirect("/");
  const all = await members();
  return (
    <>
    <AppBar />
    <main className="wrap">
      <div className="login card">
        <div className="hero">
          <p className="section-label">No Shoes Nation</p>
          <h1 className="login-title">Lowball</h1>
          <p className="muted">Last place pays. Everyone else picks a leg.</p>
        </div>
        <ActionForm action={signIn} className="stack">
          <div className="field">
            <label htmlFor="userId">Your team</label>
            <select id="userId" name="userId" required defaultValue="">
              <option value="" disabled>Choose your team</option>
              {all.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.teamName} ({m.username})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pin">League passcode</label>
            <input id="pin" name="pin" type="password" autoComplete="current-password" required />
          </div>
          <Submit className="btn btn-green btn-block">Sign in</Submit>
          <p className="small muted">You stay signed in for the season on this device.</p>
        </ActionForm>
      </div>
    </main>
    </>
  );
}
