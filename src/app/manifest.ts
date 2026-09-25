import type { MetadataRoute } from "next";

// Lets people "Add to Home Screen" and get a full-screen app with an icon.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lowball",
    short_name: "Lowball",
    description: "Last place pays. Everyone else picks a leg.",
    start_url: "/",
    display: "standalone",
    background_color: "#e4e2dd",
    theme_color: "#27abd0",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
