import Link from "next/link";

/** Teal top bar with a home button and the league name. */
export function AppBar({ title = "No Shoes Nation" }: { title?: string }) {
  return (
    <header className="appbar">
      <div className="appbar-in">
        <Link href="/" className="home-btn" aria-label="Home">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 3 2.5 11h2.8v9.5h5.2v-6h3v6h5.2V11h2.8z" />
          </svg>
        </Link>
        <span className="league-pill">{title}</span>
      </div>
    </header>
  );
}

/** Scoreboard number: "70.62" renders as 70 with a small raised .62. */
export function Num({ value, prefix = "", className = "" }: { value: number | string | null; prefix?: string; className?: string }) {
  if (value == null || value === "") return <span className={`num ${className}`}>—</span>;
  const s = typeof value === "number" ? value.toFixed(2) : value;
  const [whole, frac] = s.split(".");
  return (
    <span className={`num ${className}`}>
      {prefix}
      {whole}
      {frac != null && <sup>.{frac}</sup>}
    </span>
  );
}

export function Avatar({ src, name, size = 40 }: { src: string | null; name: string; size?: number }) {
  const initials = name
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <span className="avatar" style={{ width: size, height: size }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={size} height={size} loading="lazy" />
      ) : (
        <span style={{ fontSize: size * 0.38 }}>{initials || "?"}</span>
      )}
    </span>
  );
}

/** The little hexagon rank badge. */
export function Hex({ children }: { children: React.ReactNode }) {
  return <span className="hex">{children}</span>;
}
