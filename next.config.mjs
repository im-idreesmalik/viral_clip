/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // These packages use native binaries / Node built-ins and must not be bundled
  // by the server compiler — keep them external so they load at runtime.
  serverExternalPackages: [
    "bullmq",
    "ioredis",
    "fluent-ffmpeg",
    "ffmpeg-static",
    "ffprobe-static",
    "youtube-dl-exec",
    "@prisma/client",
    "@huggingface/transformers",
    "onnxruntime-node",
  ],
  experimental: {
    // Allow large multipart uploads through Server Actions / route handlers.
    serverActions: {
      bodySizeLimit: "2gb",
    },
  },
  // ESLint isn't wired up as a dependency here; don't block builds on it.
  // (Type checking via tsc still runs and WILL fail the build on type errors.)
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
