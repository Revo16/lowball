"use client";

import { useState } from "react";
import { ActionForm, Submit } from "@/components/client";
import { saveRecord } from "@/app/actions";
import { formatAmerican } from "@/lib/math";

export type RecordWeek = {
  week: number;
  status: "open" | "placed" | "won" | "lost" | "void";
  dkOdds: number | null;
  stake: number | null;
  payout: number | null;
  placedBy: string | null;
  loser: string | null; // who funded it (last place the week before)
  current: boolean;
  future: boolean;
};

const LABEL: Record<RecordWeek["status"], string> = { open: "Not placed", placed: "Placed", won: "Hit", lost: "Missed", void: "Void" };
const SHORT: Record<RecordWeek["status"], string> = { open: "—", placed: "LIVE", won: "HIT", lost: "MISS", void: "VOID" };

/** The whole season as week tiles. Tap one to see (or, for the admin, edit) it. */
export function RecordGrid({ weeks, isAdmin }: { weeks: RecordWeek[]; isAdmin: boolean }) {
  const current = weeks.find((w) => w.current)?.week ?? weeks[0]?.week ?? 1;
  const [sel, setSel] = useState(current);
  const w = weeks.find((x) => x.week === sel);

  return (
    <div className="record">
      <div className="tiles" role="list">
        {weeks.map((x) => (
          <button
            key={x.week}
            type="button"
            role="listitem"
            className={["tile", `tile-${x.status}`, x.current ? "tile-now" : "", x.future ? "tile-future" : "", x.week === sel ? "tile-sel" : ""].join(" ")}
            onClick={() => setSel(x.week)}
            aria-label={`Week ${x.week}: ${x.future ? "upcoming" : LABEL[x.status]}`}
            aria-pressed={x.week === sel}
          >
            <span className="tile-wk">W{x.week}</span>
            <span className="tile-res">{x.future ? "" : SHORT[x.status]}</span>
          </button>
        ))}
      </div>

      {w && (
        <div className="tile-detail">
          <div className="tile-detail-head">
            <strong>Week {w.week}</strong>
            <span className={`pill pill-${w.status === "won" ? "green" : w.status === "lost" ? "red" : w.status === "placed" ? "blue" : "grey"}`}>
              {w.future ? "Upcoming" : LABEL[w.status]}
            </span>
          </div>
          <dl className="facts">
            <div><dt>Placed by</dt><dd>{w.placedBy ?? "—"}</dd></div>
            <div><dt>Odds</dt><dd>{w.dkOdds ? formatAmerican(w.dkOdds) : "—"}</dd></div>
            <div><dt>Stake</dt><dd>{w.stake != null ? `$${w.stake.toFixed(2)}` : "—"}</dd></div>
            <div><dt>Payout</dt><dd>{w.payout != null ? `$${w.payout.toFixed(2)}` : "—"}</dd></div>
            <div><dt>Funded by</dt><dd>{w.loser ?? "—"}</dd></div>
          </dl>
          {isAdmin && !w.future && (
            <ActionForm action={saveRecord} className="stack" key={w.week}>
              <input type="hidden" name="week" value={w.week} />
              <div className="row">
                <div className="field">
                  <label htmlFor={`st-${w.week}`}>Result</label>
                  <select id={`st-${w.week}`} name="status" defaultValue={w.status}>
                    {Object.entries(LABEL).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`od-${w.week}`}>Odds</label>
                  <input id={`od-${w.week}`} name="dk_odds" inputMode="numeric" defaultValue={w.dkOdds ?? ""} placeholder="+2150" />
                </div>
              </div>
              <div className="row">
                <div className="field">
                  <label htmlFor={`sk-${w.week}`}>Stake ($)</label>
                  <input id={`sk-${w.week}`} name="stake" inputMode="decimal" defaultValue={w.stake ?? ""} />
                </div>
                <div className="field">
                  <label htmlFor={`po-${w.week}`}>Payout ($)</label>
                  <input id={`po-${w.week}`} name="payout" inputMode="decimal" defaultValue={w.payout ?? ""} placeholder="if it hit" />
                </div>
              </div>
              <Submit className="btn btn-green">Save week {w.week}</Submit>
            </ActionForm>
          )}
        </div>
      )}
    </div>
  );
}
