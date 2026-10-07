// A real EIP-1193 wallet for headless browser tests: the page gets `window.ethereum` (and an EIP-6963
// announcement), every signature is made in Node by a viem account from a local test key, and every transaction is
// signed and sent to the local fork. Signatures and transactions are real; only the wallet's UI is absent (it
// approves everything the page asks). Local anvil fork only.
import { createWalletClient, http, numberToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export async function installWallet(page, key, { rpc = "http://127.0.0.1:18643", chainId = 10143 } = {}) {
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(rpc)) throw new Error("wallet shim only signs for a local chain");
  const account = privateKeyToAccount(key);
  const wallet = createWalletClient({ account, transport: http(rpc) });
  const log = [];
  await page.exposeFunction("__komaWallet", async (method, params) => {
    log.push(method);
    switch (method) {
      case "personal_sign":
        return account.signMessage({ message: { raw: params[0] } });
      case "eth_signTypedData_v4": {
        const t = typeof params[1] === "string" ? JSON.parse(params[1]) : params[1];
        const { EIP712Domain: _, ...types } = t.types;
        return account.signTypedData({ domain: t.domain, types, primaryType: t.primaryType, message: t.message });
      }
      case "eth_sendTransaction": {
        const tx = params[0];
        return wallet.sendTransaction({
          chain: null,
          to: tx.to,
          data: tx.data,
          value: tx.value ? BigInt(tx.value) : undefined,
          gas: tx.gas ? BigInt(tx.gas) : undefined,
        });
      }
      default: {
        const res = await fetch(rpc, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
        const j = await res.json();
        if (j.error) throw new Error(j.error.message);
        return j.result;
      }
    }
  });
  await page.addInitScript(
    ({ address, chainHex }) => {
      const listeners = {};
      const provider = {
        isMetaMask: false,
        isKomaTestWallet: true,
        async request({ method, params = [] }) {
          // Like a real wallet: no accounts until the site asks once; then the grant is remembered.
          const KEY = "koma-test-wallet-granted";
          if (method === "eth_requestAccounts") {
            try {
              localStorage.setItem(KEY, "1");
            } catch {}
            return [address];
          }
          if (method === "eth_accounts") {
            let granted = false;
            try {
              granted = localStorage.getItem(KEY) === "1";
            } catch {}
            return granted ? [address] : [];
          }
          if (method === "eth_chainId") return chainHex;
          if (method === "net_version") return String(parseInt(chainHex, 16));
          if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
          if (method === "wallet_requestPermissions" || method === "wallet_getPermissions") return [{ parentCapability: "eth_accounts" }];
          return window.__komaWallet(method, params);
        },
        on(ev, fn) {
          (listeners[ev] ??= []).push(fn);
        },
        removeListener(ev, fn) {
          listeners[ev] = (listeners[ev] ?? []).filter((f) => f !== fn);
        },
      };
      window.ethereum = provider;
      const info = { uuid: "5f7c0d5e-0000-4000-8000-00000000c0de", name: "KOMA test wallet", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>", rdns: "xyz.koma.testwallet" };
      const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    },
    { address: account.address, chainHex: numberToHex(chainId) },
  );
  return { address: account.address, log };
}
