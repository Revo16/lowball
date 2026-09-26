"use client";

import { useEffect } from "react";

// Shown instead of a blank "Application error" if a screen crashes. The usual
// cause is a phone that had the app open across an update, so reload once
// automatically, then offer a button.
export default function ErrorScreen({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
    let last = 0;
    try {
      last = Number(sessionStorage.getItem("lowball.autoreload") ?? 0);
    } catch {}
    if (Date.now() - last > 30_000) {
      try {
        sessionStorage.setItem("lowball.autoreload", String(Date.now()));
      } catch {}
      window.location.reload();
    }
  }, [error]);

  return (
    <main className="wrap" style={{ paddingTop: 48, textAlign: "center" }}>
      <section className="card" style={{ display: "grid", gap: 12, justifyItems: "center" }}>
        <h2 className="h-section">Something went sideways</h2>
        <p className="fine">Usually this means the app updated while it was open.</p>
        <button type="button" className="btn btn-green" onClick={() => window.location.reload()}>
          Reload
        </button>
        <button type="button" className="btn-link" onClick={() => reset()}>
          Try again without reloading
        </button>
      </section>
    </main>
  );
}
