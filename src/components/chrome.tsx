export function StatusChip({ status }: { status: string }) {
  const label: Record<string, string> = {
    open: "Taking picks",
    "open-plain": "Not placed",
    locked: "Locked",
    placed: "Placed",
    won: "Hit",
    lost: "Missed",
    void: "Void",
  };
  const tone: Record<string, string> = { "open-plain": "grey", open: "green", locked: "red", placed: "blue", won: "green", lost: "grey", void: "grey" };
  return <span className={`pill pill-${tone[status] ?? "grey"}`}>{label[status] ?? status}</span>;
}

export function PayChip({ state, amount }: { state: "owes" | "says-paid" | "paid"; amount: number }) {
  if (state === "paid") return <span className="pill pill-green">Paid</span>;
  if (state === "says-paid") return <span className="pill pill-amber">Says paid</span>;
  return <span className="pill pill-red">Owes ${amount}</span>;
}
