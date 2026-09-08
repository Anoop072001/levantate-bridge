import Link from "next/link";

export default function HomePage() {
  return (
    <main style={{ maxWidth: 640, margin: "4rem auto", padding: "0 1rem", fontFamily: "system-ui" }}>
      <h1>Levantate Bridge</h1>
      <p>Worker-facing marketplace on Arc testnet USDC.</p>
      <p>
        <Link href="/verify?signal=demo-task-0-round-0">Verify with World ID to bid</Link>
      </p>
    </main>
  );
}
