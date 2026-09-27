"use client";

import { useEffect, useState, type ReactNode } from "react";
import { placeBet } from "@/app/actions";
import { formatPt } from "@/lib/weeks";
import type { SlipData } from "@/lib/slip";

/** A panel that slides up from the bottom over The Slip. Tap outside or ✕ to close. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", esc);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="sheet-layer" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="sheet-scrim" aria-label="Close" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-head">
          <span className="sheet-grab" aria-hidden="true" />
          <h3>{title}</h3>
          <button type="button" className="sheet-x" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Tapping DK when some legs can't ride in the link (or early games are on the slip). */
export function DkSheet({ place, onClose }: { place: SlipData["place"]; onClose: () => void }) {
  const href = place.link ?? "https://sportsbook.draftkings.com/";
  return (
    <Sheet title="Open in DraftKings" onClose={onClose}>
      {place.early && (
        <p className="notice">
          Early game on the slip ({place.early.names.join(", ")}). Place it and tap + by{" "}
          <b>{formatPt(new Date(place.early.cutoff))} PT</b>, or {place.early.names.length === 1 ? "that leg comes" : "those legs come"} off.
        </p>
      )}
      {place.byHand.length > 0 && (
        <>
          <p className="fine" style={{ margin: 0 }}>
            {place.inLink > 0 ? `${place.inLink} leg${place.inLink === 1 ? "" : "s"} load onto one betslip. ` : ""}
            {place.byHand.length === 1 ? "This one" : `These ${place.byHand.length}`} can&apos;t go in the link, so add{" "}
            {place.byHand.length === 1 ? "it" : "them"} by hand before placing:
          </p>
          <ol className="byhand">
            {place.byHand.map((l, i) => (
              <li key={i}>
                <b>{l.selection}</b> · {l.teamName}
              </li>
            ))}
          </ol>
        </>
      )}
      <a className="btn btn-green btn-block" href={href} target="_blank" rel="noopener noreferrer" onClick={() => setTimeout(onClose, 300)}>
        Open DraftKings{place.inLink ? ` · ${place.inLink} leg${place.inLink === 1 ? "" : "s"}` : ""}
      </a>
      <p className="fine center" style={{ margin: 0 }}>
        Check the betslip shows {place.legs} legs, place it, then come back and tap +.
      </p>
    </Sheet>
  );
}

/** Tapping the + on the ? picture: record the bet and become the week's bookie. */
export function PlaceSheet({
  week,
  place,
  losers,
  onClose,
  onDone,
}: {
  week: number;
  place: SlipData["place"];
  losers: string[];
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [sign, setSign] = useState<"+" | "-">("+");
  const [digits, setDigits] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("dk_odds", digits ? `${sign}${digits}` : "");
    setBusy(true);
    setError(null);
    const r = await placeBet({}, fd);
    setBusy(false);
    if (r.error) return setError(r.error);
    onDone(r.ok ?? `You're the Week ${week} bookie.`);
  }

  return (
    <Sheet title="I placed it" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="field">
          <label htmlFor="place-odds">Final odds from DraftKings</label>
          <div className="odds-field">
            <div className="sign-toggle" role="radiogroup" aria-label="Odds sign">
              {(["-", "+"] as const).map((x) => (
                <button key={x} type="button" role="radio" aria-checked={sign === x} className={sign === x ? "on" : ""} onClick={() => setSign(x)}>
                  {x === "-" ? "−" : "+"}
                </button>
              ))}
            </div>
            <input
              id="place-odds"
              inputMode="numeric"
              placeholder="2450"
              value={digits}
              onChange={(e) => {
                const raw = e.target.value.trim();
                if (raw.startsWith("-") || raw.startsWith("−")) setSign("-");
                else if (raw.startsWith("+")) setSign("+");
                setDigits(raw.replace(/[^0-9]/g, "").slice(0, 7));
              }}
            />
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="place-stake">Stake ($)</label>
            <input id="place-stake" name="stake" inputMode="decimal" defaultValue={place.stake} />
          </div>
          <div className="field">
            <label htmlFor="place-venmo">Your Venmo</label>
            <input
              id="place-venmo"
              name="venmo"
              defaultValue={place.myVenmo}
              placeholder="venmo-name"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="place-note">Note (optional)</label>
          <input id="place-note" name="note" maxLength={200} placeholder="Swapped JSN 74.5 for 70.5" />
        </div>
        {error && (
          <p className="notice bad" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-green btn-block" disabled={busy}>
          {busy ? "Saving…" : `Confirm: I'm the Week ${week} bookie`}
        </button>
        <p className="fine center" style={{ margin: 0 }}>
          {losers.length
            ? `${losers.join(" and ")} ${losers.length === 1 ? "gets" : "get"} a push to pay you $${place.stake / Math.max(1, losers.length)}.`
            : "Only once DraftKings has confirmed the bet."}{" "}
          The slip freezes at these odds.
        </p>
      </form>
    </Sheet>
  );
}
