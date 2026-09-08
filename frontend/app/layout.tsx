import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Levantate Bridge",
  description: "Agent-to-human task marketplace on Arc testnet",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
