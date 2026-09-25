/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [{ source: "/pick", destination: "/search", permanent: false }];
  },
};

export default nextConfig;
