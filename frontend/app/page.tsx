import Link from "next/link";

export default function HomePage() {
  return (
    <main style={{ maxWidth: 640, margin: "4rem auto", padding: "0 1rem", fontFamily: "system-ui" }}>
      <h1>Levantate Bridge</h1>
      <p>Worker-facing marketplace on Arc testnet USDC.</p>
      <ul>
        <li>
          <Link href="/tasks">Browse open tasks</Link>
        </li>
        <li>
          <Link href="/verify?signal=browse&return=/tasks">Verify with World ID</Link>
        </li>
      </ul>
    </main>
  );
}
