const fastApiRewriteOrigin =
  process.env.FAST_API_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_FAST_API ||
  "http://localhost:5000";

const backendAssetRewrite = (path) => ({
  source: `/app_data/${path}/:path*`,
  destination: `${fastApiRewriteOrigin}/app_data/${path}/:path*`,
});

const nextConfig = {
  reactStrictMode: false,
  distDir: ".next-build",
  output: "standalone",
  ...(process.env.NODE_ENV !== "production"
    ? {
        allowedDevOrigins: [
          "http://127.0.0.1:40001",
          "http://localhost:40001",
          "127.0.0.1",
          "localhost",
        ],
      }
    : {}),

  // Rewrites for development - proxy backend-served assets to FastAPI.
  async rewrites() {
    return [
      backendAssetRewrite("fonts"),
      backendAssetRewrite("uploads"),
      backendAssetRewrite("images"),
      backendAssetRewrite("exports"),
      backendAssetRewrite("pptx-to-html"),
      backendAssetRewrite("pptx-to-json"),
    ];
  },

  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "pub-7c765f3726084c52bcd5d180d51f1255.r2.dev",
      },
      {
        protocol: "https",
        hostname: "pptgen-public.ap-south-1.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "pptgen-public.s3.ap-south-1.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "img.icons8.com",
      },
      {
        protocol: "https",
        hostname: "present-for-me.s3.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "yefhrkuqbjcblofdcpnr.supabase.co",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "picsum.photos",
      },
      {
        protocol: "https",
        hostname: "unsplash.com",
      },
    ],
  },
  
};

export default nextConfig;
