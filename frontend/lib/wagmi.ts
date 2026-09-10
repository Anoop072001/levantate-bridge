import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  injectedWallet,
  metaMaskWallet,
  rainbowWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig } from "wagmi";
import { arcTestnet } from "viem/chains";
import { createArcHttpTransport } from "./arc-rpc";

/**
 * WalletConnect Cloud project id — public by design, required by RainbowKit.
 * Create a free one at https://cloud.reown.com and set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID.
 * Injected wallets (MetaMask) still work if this is a placeholder; WalletConnect QR will not.
 *
 * Coinbase / Base Account is omitted: its connector pulls optional x402 SVM packages that
 * Next 16 cannot resolve, and those wallets are not used on Arc testnet.
 */
const projectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "00000000000000000000000000000000";

/** WalletConnect / Rainbow fetch Reown cloud config on init — 403 on localhost without allowlist. */
const recommendedWallets =
  process.env.NODE_ENV === "development"
    ? [metaMaskWallet, injectedWallet]
    : [metaMaskWallet, rainbowWallet, injectedWallet, walletConnectWallet];

const connectors = connectorsForWallets(
  [
    {
      groupName: "Recommended",
      wallets: recommendedWallets,
    },
  ],
  {
    appName: "Levantate Bridge",
    projectId,
  },
);

export const config = createConfig({
  connectors,
  chains: [arcTestnet],
  transports: {
    [arcTestnet.id]: createArcHttpTransport(),
  },
  ssr: true,
});
