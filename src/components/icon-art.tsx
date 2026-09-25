// App icon: a paper betting slip on dark turf, drawn with plain boxes so
// next/og can render it without fonts.
export function IconArt({ size }: { size: number }) {
  const u = size / 100;
  const line = (w: number, top: number, color = "#1d2530") => (
    <div style={{ position: "absolute", left: 30 * u, top: top * u, width: w * u, height: 5 * u, borderRadius: 3 * u, background: color }} />
  );
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", background: "#27abd0", position: "relative" }}>
      <div
        style={{
          position: "absolute",
          left: 22 * u,
          top: 14 * u,
          width: 56 * u,
          height: 72 * u,
          background: "#ffffff",
          borderRadius: 4 * u,
          display: "flex",
        }}
      />
      {line(40, 26)}
      {line(28, 38)}
      {line(34, 50)}
      {line(40, 68, "#2cb45a")}
    </div>
  );
}
