const withPWA = require("@ducanh2912/next-pwa").default({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  fallbacks: {
    document: "/offline",
  },
  extendDefaultRuntimeCaching: true,
  // room status must be live — never serve /api from SW cache
  runtimeCaching: [
    {
      urlPattern: ({ sameOrigin, url }) =>
        sameOrigin &&
        url.pathname.startsWith("/api/") &&
        !url.pathname.startsWith("/api/auth/callback"),
      handler: "NetworkOnly",
      method: "GET",
      options: { cacheName: "apis" },
    },
  ],
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

module.exports = withPWA(nextConfig);
