import Link from "next/link";
import { AvatarImg } from "@/components/AvatarImg";

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
      <AvatarImg src={src} initials={initials || "?"} size={size} />
    </span>
  );
}

/** The little hexagon rank badge. */
export function Hex({ children }: { children: React.ReactNode }) {
  return <span className="hex">{children}</span>;
}

/** Small padlock for "Own pick": only that player can change it. */
export function LockIcon() {
  return (
    <svg className="lock-ic" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
      <rect x="3" y="7" width="10" height="8" rx="1.5" fill="currentColor" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
