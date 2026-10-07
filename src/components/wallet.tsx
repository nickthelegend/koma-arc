"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http, injected, useConnect, useConnection, useDisconnect, useReadContract, useSwitchChain } from "wagmi";
import { getWalletClient } from "wagmi/actions";
import { PrivyProvider, usePrivy, useSendTransaction, useSigners } from "@privy-io/react-auth";
import { WagmiProvider as PrivyWagmiProvider, createConfig as privyCreateConfig } from "@privy-io/wagmi";
import { encodeFunctionData, erc20Abi, formatUnits, type Abi } from "viem";
import type { ClientEvmSigner } from "@x402/evm";
import { KOMA, RPC_URL, USDC_DECIMALS } from "@/lib/network";

/**
 * Two account layers, picked at build time:
 *  - NEXT_PUBLIC_PRIVY_APP_ID set: Privy (email / Google / passkey / external wallet) with an embedded wallet.
 *    Direct transactions from the embedded wallet are gas-sponsored by Privy (`sponsor: true`), and the
 *    backer autopilot adds KOMA's session signer to it with a policy.
 *  - otherwise: any injected browser wallet.
 */
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
export const PRIVY = Boolean(PRIVY_APP_ID);

const transports = { [KOMA.chain.id]: http(RPC_URL) } as Record<typeof KOMA.chain.id, ReturnType<typeof http>>;
export const wagmiConfig = PRIVY
  ? (privyCreateConfig({ chains: [KOMA.chain], transports, ssr: true }) as unknown as ReturnType<typeof injectedConfig>)
  : injectedConfig();
function injectedConfig() {
  return createConfig({ chains: [KOMA.chain], connectors: [injected()], transports, ssr: true });
}

type Wallet = {
  address: `0x${string}` | null;
  usdc: number;
  /** False until the first balance read lands; `usdc` is 0 until then, so don't treat it as empty. */
  usdcLoaded: boolean;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  refreshBalance: () => void;
  /** Puts the wallet on KOMA's chain and returns an x402 signer for it. */
  signer: () => Promise<ClientEvmSigner>;
  /** Puts the wallet on KOMA's chain and returns its viem wallet client (typed-data signatures, direct transactions). */
  walletClient: () => Promise<WalletClient>;
  /** Privy embedded wallet details, when Privy is the account layer. */
  privy: null | {
    /** The embedded wallet's Privy id (the server signs with it under the backer's policy). */
    walletId: string | null;
    embedded: boolean;
    /** Direct transactions are sponsored by Privy when this is true. */
    sponsored: boolean;
    addSigners: (signerId: string, policyIds: string[]) => Promise<void>;
    removeSigners: () => Promise<void>;
  };
};

export type WalletClient = Awaited<ReturnType<typeof getWalletClient<typeof wagmiConfig, typeof KOMA.chain.id>>>;

const Ctx = createContext<Wallet | null>(null);

function friendly(e: unknown) {
  const msg = (e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? "";
  if (/provider not found|no provider/i.test(msg)) return "No browser wallet found. Install MetaMask, Rabby or Coinbase Wallet.";
  if (/reject|denied/i.test(msg)) return "Request cancelled in your wallet.";
  return msg || "Wallet error.";
}

type Extra = { connect?: () => Promise<void>; disconnect?: () => void; wrapClient?: (c: WalletClient) => WalletClient; privy?: Wallet["privy"]; connecting?: boolean };

function useWalletCore(extra: Extra): Wallet {
  const { address, chainId } = useConnection();
  const connectM = useConnect();
  const disconnectM = useDisconnect();
  const switchM = useSwitchChain();
  const [error, setError] = useState<string | null>(null);

  const balance = useReadContract({
    address: KOMA.usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: KOMA.chain.id,
    query: { enabled: Boolean(address), refetchInterval: 15_000 },
  });

  const injectedConnect = useCallback(async () => {
    setError(null);
    try {
      await connectM.mutateAsync({ connector: injected(), chainId: KOMA.chain.id });
    } catch (e) {
      setError(friendly(e));
    }
  }, [connectM]);
  const connect = extra.connect ?? injectedConnect;
  const { wrapClient } = extra;

  const walletClient = useCallback(async (): Promise<WalletClient> => {
    if (chainId !== KOMA.chain.id) await switchM.mutateAsync({ chainId: KOMA.chain.id });
    const client = await getWalletClient(wagmiConfig, { chainId: KOMA.chain.id });
    return wrapClient ? wrapClient(client) : client;
  }, [chainId, switchM, wrapClient]);

  const signer = useCallback(async (): Promise<ClientEvmSigner> => {
    const client = await walletClient();
    return {
      address: client.account.address,
      signTypedData: (m) => client.signTypedData({ account: client.account, ...(m as object) } as never),
    };
  }, [walletClient]);

  return useMemo<Wallet>(
    () => ({
      address: address ?? null,
      usdc: balance.data !== undefined ? Number(formatUnits(balance.data, USDC_DECIMALS)) : 0,
      usdcLoaded: balance.data !== undefined,
      connecting: extra.connecting ?? connectM.isPending,
      error,
      connect,
      disconnect: extra.disconnect ?? (() => disconnectM.mutate()),
      refreshBalance: () => void balance.refetch(),
      signer,
      walletClient,
      privy: extra.privy ?? null,
    }),
    [address, balance, connectM.isPending, error, connect, disconnectM, signer, walletClient, extra.disconnect, extra.privy, extra.connecting],
  );
}

function InjectedWalletState({ children }: { children: React.ReactNode }) {
  const value = useWalletCore({});
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function PrivyWalletState({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { sendTransaction } = useSendTransaction();
  const { addSigners, removeSigners } = useSigners();
  const embedded = user?.linkedAccounts.find(
    (a): a is Extract<typeof a, { type: "wallet" }> => a.type === "wallet" && (a as { walletClientType?: string }).walletClientType === "privy",
  );
  const address = embedded?.address as `0x${string}` | undefined;

  // Direct transactions from the embedded wallet go through Privy with gas sponsorship.
  const wrapClient = useCallback(
    (client: WalletClient): WalletClient => {
      if (!embedded || client.account.address.toLowerCase() !== embedded.address.toLowerCase()) return client;
      const sponsoredWrite = async (args: { address: `0x${string}`; abi: Abi; functionName: string; args?: readonly unknown[]; value?: bigint }) => {
        const data = encodeFunctionData({ abi: args.abi, functionName: args.functionName, args: args.args } as never);
        const { hash } = await sendTransaction(
          { to: args.address, data, value: args.value, chainId: KOMA.chain.id },
          { sponsor: true, address: embedded.address, uiOptions: { showWalletUIs: false } } as never,
        );
        return hash;
      };
      return new Proxy(client, { get: (t, p, r) => (p === "writeContract" ? sponsoredWrite : Reflect.get(t, p, r)) });
    },
    [embedded, sendTransaction],
  );

  const privy = useMemo<Wallet["privy"]>(
    () => ({
      walletId: (embedded as { id?: string | null } | undefined)?.id ?? null,
      embedded: Boolean(embedded),
      sponsored: Boolean(embedded),
      addSigners: async (signerId, policyIds) => {
        if (!address) throw new Error("No embedded wallet");
        await addSigners({ address, signers: [{ signerId, policyIds }] });
      },
      removeSigners: async () => {
        if (!address) throw new Error("No embedded wallet");
        await removeSigners({ address });
      },
    }),
    [embedded, address, addSigners, removeSigners],
  );

  const value = useWalletCore({
    connect: async () => login(),
    disconnect: () => void logout(),
    wrapClient,
    privy,
    connecting: !ready || (authenticated && !address),
  });
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  if (PRIVY) {
    return (
      <PrivyProvider
        appId={PRIVY_APP_ID}
        config={{
          loginMethods: ["email", "google", "passkey", "wallet"],
          embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" }, showWalletUIs: false },
          defaultChain: KOMA.chain,
          supportedChains: [KOMA.chain],
          appearance: { theme: "dark", accentColor: "#ff4a1c", walletChainType: "ethereum-only" },
        }}
      >
        <QueryClientProvider client={queryClient}>
          <PrivyWagmiProvider config={wagmiConfig as never}>
            <PrivyWalletState>{children}</PrivyWalletState>
          </PrivyWagmiProvider>
        </QueryClientProvider>
      </PrivyProvider>
    );
  }
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <InjectedWalletState>{children}</InjectedWalletState>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export function useWallet() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet outside WalletProvider");
  return v;
}

export { friendly as walletErrorMessage };
