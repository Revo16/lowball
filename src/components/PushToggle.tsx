"use client";

import { useEffect, useState } from "react";

type State = "loading" | "unsupported" | "ios-install" | "off" | "on" | "denied" | "working";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** Card that turns on push notifications for this phone. Hides itself once on. */
export function PushToggle({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<State>("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone =
        window.matchMedia?.("(display-mode: standalone)").matches ||
        (navigator as unknown as { standalone?: boolean }).standalone === true;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setState(ios && !standalone ? "ios-install" : "unsupported");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        const sub = await reg.pushManager.getSubscription();
        if (Notification.permission === "denied") setState("denied");
        else setState(sub ? "on" : "off");
        // Keep the server's copy fresh (subscriptions can rotate).
        if (sub) fetch("/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub) });
      } catch {
        setState("unsupported");
      }
    })();
  }, []);

  async function turnOn() {
    setError("");
    setState("working");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
      const res = await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Couldn't save");
      setState("on");
    } catch (err) {
      setError((err as Error).message);
      setState("off");
    }
  }

  if (state === "loading" || state === "on" || state === "unsupported") return null;

  return (
    <section className="notify-card" aria-label="Notifications">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1z" />
      </svg>
      <div>
        <strong>Get nudged when you haven&apos;t picked</strong>
        <span>
          {state === "ios-install"
            ? "On iPhone: tap Share → Add to Home Screen, open Lowball from there, then turn on notifications here."
            : state === "denied"
              ? "Notifications are blocked for Lowball. Turn them on in your phone's settings for this app or site."
              : "One ping when someone taps Nudge, plus Friday and Saturday reminders if you're missing a leg."}
        </span>
        {error && <span className="msg msg-error">{error}</span>}
      </div>
      {(state === "off" || state === "working") && (
        <button type="button" className="btn btn-green" onClick={turnOn} disabled={state === "working"}>
          {state === "working" ? "…" : "Turn on"}
        </button>
      )}
    </section>
  );
}
