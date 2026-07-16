/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @react-pdf/renderer must be treated as an external on the server
  serverExternalPackages: ["@react-pdf/renderer"],
  // Ensure the Purchase Order / 2307 Excel template ships with the serverless
  // function that fills it (it's read from disk at request time).
  outputFileTracingIncludes: {
    "/(app)/orders/[id]/po/[prId]/xlsx": [
      "./public/templates/po-2307-template.xlsx",
      "./public/templates/2307-source.xlsx",
    ],
    "/(app)/orders/[id]/jo/[index]/xlsx": [
      "./public/templates/fans-jo-template.xlsx",
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
