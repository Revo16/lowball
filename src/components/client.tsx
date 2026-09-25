"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, useState } from "react";
import type { FormState } from "@/app/actions";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

const Pending = createContext(false);

/**
 * A form wired to a server action, with its result shown inline.
 * Submits manually so React doesn't clear what the person typed when the
 * server sends back an error.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  onSuccess,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  onSuccess?: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  const cb = useRef(onSuccess);
  cb.current = onSuccess;
  useEffect(() => {
    if (!state.ok) return;
    if (resetOnSuccess) ref.current?.reset();
    cb.current?.();
  }, [state, resetOnSuccess]);
  return (
    <Pending.Provider value={pending}>
      <form
        ref={ref}
        className={className}
        aria-busy={pending}
        onSubmit={(e) => {
          e.preventDefault();
          const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
          const data = new FormData(e.currentTarget, submitter);
          startTransition(() => formAction(data));
        }}
      >
        {children}
        {!pending && state.error && <p className="msg msg-error" role="alert">{state.error}</p>}
        {!pending && state.ok && <p className="msg msg-ok" role="status">{state.ok}</p>}
      </form>
    </Pending.Provider>
  );
}

export function Submit({ children, className = "btn", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const pending = useContext(Pending);
  return (
    <button type="submit" className={className} disabled={pending || rest.disabled} {...rest}>
      {children}
    </button>
  );
}

export function Countdown({ to }: { to: string }) {
  const target = new Date(to).getTime();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (now == null) return <span className="mono">—</span>;
  const ms = Math.max(0, target - now);
  if (ms === 0) return <span className="mono">Locked</span>;
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <span className="mono" aria-label={`${d} days ${h} hours ${m} minutes left`}>
      {d > 0 && `${d}d `}{pad(h)}:{pad(m)}:{pad(s)}
    </span>
  );
}

export function CopyButton({ text, label = "Copy slip" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        } catch {
          setDone(false);
        }
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}
