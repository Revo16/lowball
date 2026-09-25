// Venmo closed its public API to new apps, so nothing can send a request on
// someone's behalf. This link opens Venmo with the recipient, amount and note
// already filled in; on a phone with Venmo installed it jumps straight to the
// app. The loser only has to tap Pay.

export function venmoPayLink(opts: { to: string; amount: number; note: string }): string {
  const params = new URLSearchParams({
    txn: "pay",
    audience: "private",
    recipients: opts.to.replace(/^@/, ""),
    amount: opts.amount.toFixed(2),
    note: opts.note,
  });
  return `https://venmo.com/?${params.toString()}`;
}
