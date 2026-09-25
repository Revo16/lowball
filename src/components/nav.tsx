import Link from "next/link";

type Tab = "slip" | "search" | "bookie" | "league";

function Icon({ name }: { name: Tab }) {
  const common = { width: 26, height: 26, viewBox: "0 0 24 24", "aria-hidden": true };
  if (name === "slip")
    return (
      <svg {...common} fill="currentColor">
        <path d="M5 2h14v19.5l-2.33-1.4L14.33 21.5 12 20.1l-2.33 1.4-2.34-1.4L5 21.5z" opacity=".9" />
        <path d="M8 7h8M8 11h8M8 15h5" stroke="var(--tab-cut)" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  if (name === "search")
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m15.5 15.5 5 5" />
      </svg>
    );
  if (name === "league")
    return (
      <svg {...common} fill="currentColor">
        <path d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 14.9V18h3v3H8v-3h3v-3.1A5 5 0 0 1 8.3 12H8a4 4 0 0 1-4-4V5h3zm0 4H6v1a2 2 0 0 0 1 1.7zm10 0v2.7A2 2 0 0 0 18 8V7z" />
      </svg>
    );
  return (
    <svg {...common} fill="currentColor">
      <path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z" />
    </svg>
  );
}

/** Bottom tabs: grey icons, the active one in gold. */
export function BottomNav({ current }: { current: Tab; isBookie?: boolean }) {
  const tabs: Array<{ id: Tab; href: string; label: string }> = [
    { id: "slip", href: "/", label: "Slip" },
    { id: "search", href: "/search", label: "Find a bet" },
    { id: "bookie", href: "/bookie", label: "Bookie" },
    { id: "league", href: "/league", label: "League" },
  ];
  return (
    <nav className="tabbar" aria-label="Main">
      {tabs.map((t) => (
        <Link key={t.id} href={t.href} className="tab" aria-current={current === t.id ? "page" : undefined}>
          <Icon name={t.id} />
          <span>{t.label}</span>
        </Link>
      ))}
    </nav>
  );
}
