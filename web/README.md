# imd-compute frontend

Static single-page dashboard for the Identity MD seat compute project on **Sepolia (chain 11155111)**.
It shows the live `SeatCompute` (COMPUTE) token and `ComputeProject` companion, the per-seat
inference dashboard from the public `api.imd.fun` endpoints, wallet-linked seat highlighting,
ERC-20 transfer/approve controls and an ETH ⇄ COMPUTE swap through the vetted Uniswap v4
addresses. Built with Vite, React 19, TypeScript and viem. No backend, no server rewrites:
the export in `../dist` works from a plain file host, an IPFS gateway subpath or an ENS name.

## Layout

| Path | Purpose |
| --- | --- |
| `handoff/deployment.json`, `handoff/network.json` | Copies of the workflow handoff this frontend was built against (source of the runtime manifest). |
| `scripts/sync-handoff.mjs` | Verifies each `../docs/abi/<Contract>.json` against the handoff `abiHash` (Keccak-256 of the key-sorted, whitespace-free JSON) and writes `public/abi/*.json` + a runtime `public/imd-deployment.json`. |
| `scripts/manifest.mjs` | After `vite build`, rewrites `../dist/imd-deployment.json` with the SHA-256 of every other exported file. `--check` verifies the committed manifest. |
| `scripts/snapshot.mjs` | Optional: captures a trimmed copy of the two public APIs to `public/data/snapshot.json` (fallback data, see below). |
| `src/config.ts` | Non-deployment configuration: API URLs, online threshold, optional mainnet seat lookup, swap defaults, optional WalletConnect id. |
| `src/lib/deployment.ts` | Loads `./imd-deployment.json` and the referenced ABIs at runtime; builds the public RPC client from the manifest's `network.rpcUrls`. |
| `src/lib/wallet.ts`, `src/lib/useWallet.ts` | EIP-6963 / `window.ethereum` discovery, connect, `wallet_switchEthereumChain` → `wallet_addEthereumChain` fallback. |
| `src/lib/dashboard.ts` | API fetch, contributor ⇄ worker join, filters, sorting, URL-hash state. |
| `src/lib/swap.ts`, `src/lib/uniswapAbi.ts` | Uniswap v4 pool key, quoter call and Universal Router `execute` encoding (V4_SWAP, actions `0x060c0f`). |
| `src/components/*` | Wallet bar, deployment panel, dashboard table, token actions, swap panel. |
| `src/**/*.test.ts(x)` | Vitest + Testing Library suite with a mocked EIP-1193 wallet and a fake JSON-RPC chain. |

## Configuration: one source of truth

Contract addresses, chain id, ABI paths, public RPC URLs, the explorer and the Uniswap v4
addresses all live in **`dist/imd-deployment.json`**, which the app fetches relative to
`index.html` at start-up. Nothing in `src/` duplicates an address or chain id. The manifest is
generated from `handoff/*.json` and `../docs/abi`, so to retarget a deployment replace those
inputs and rebuild. There are no private credentials anywhere; the RPC URLs are the public
endpoints from the vetted network table.

`src/config.ts` holds only public, non-deployment settings:

- `API.contributors` / `API.workers` – `https://api.imd.fun/contributors` and `/workers`.
- `ONLINE_THRESHOLD_MS` – a worker is "online" when its last heartbeat is ≤ 5 minutes old.
- `MAINNET_SEAT_LOOKUP` – optional, read-only `ownerOf` on mainnet collection
  `0x0000ec93127baa929e58e97dd0095a2bfb38ec1d`, used **only** for contributor rows whose
  `wallet` is missing; it never blocks the UI and is not the launch chain.
- `WALLETCONNECT_PROJECT_ID` – read from `VITE_WALLETCONNECT_PROJECT_ID` at build time. None
  is supplied for this deployment, so only injected browser wallets (EIP-6963 or
  `window.ethereum`) are offered. Adding WalletConnect would require a connector dependency;
  the id itself is public.
- `SWAP_DEFAULTS` – 1 % slippage, 20-minute deadline, 30-day Permit2 expiration.

## Install, develop, build

```sh
cd web
npm ci                 # or npm install
npm run dev            # syncs the handoff into public/ and starts Vite
npm run typecheck
npm test               # vitest (43 tests)
npm run build          # sync → typecheck → vite build → ../dist + imd-deployment.json
npm run verify:manifest
npm run preview        # serve ../dist locally
npm run check          # test + build + manifest verification
```

`npm run build` writes the export to the repository-root `dist/` (relative `base: './'`) and
then regenerates `dist/imd-deployment.json`. Re-run it after **any** source or asset change and
commit `dist/` together with the source; the publisher pins the committed files as-is.

`npm run build:refresh` first re-captures the API snapshot (see below), then builds. The committed
`public/data/snapshot.json` is what makes `npm run build` reproduce the committed export.

## Runtime behaviour

**Dashboard.** Loads `/contributors` and `/workers`, joins each contributor to its worker by
`deviceKey` when both carry one, otherwise by the string form of `seat.tokenId`; contributors
without a worker are still listed. Default sort is `outputTokens` descending; columns are
sortable; filters are online-only, runtime, minimum accepted and a tokenId/wallet search; the
`asOf` time and a Refresh button sit in the header; filter state is mirrored in the URL hash so
views are deep-linkable. Counters are labelled as plane-reported, not audited billing.

**API fallback.** At build time `api.imd.fun` answered without `Access-Control-Allow-Origin`
headers, so a browser on a gateway origin may be blocked by CORS. The app always tries the live
API first; if that fails it loads `./data/snapshot.json` (captured by `scripts/snapshot.mjs`)
and shows a prominent "Snapshot as of …" notice with the reason. If neither is available an
error with a retry hint is shown.

**Wallet.** Connect via EIP-1193. On connect every row whose `wallet` equals the connected
address (both lowercased) is highlighted and a "N seats linked" chip appears; account changes
recompute the matches and Disconnect clears them. No token ids or allowlists are hard-coded. If
the wallet is on another chain a single "Switch to Sepolia" control calls
`wallet_switchEthereumChain`; on error 4902 (or an "unrecognized chain" message) it calls
`wallet_addEthereumChain` with the `walletAddChain` parameters derived from the manifest's
network block, then switches again.

**Transactions.** Transfer and approve are gated until (1) the manifest's RPC reports the
manifest chain id, (2) both contract addresses hold code, (3) both ABI hashes match, and (4) the
wallet is connected on that chain. Every write is `simulateContract`-ed first; revert reasons
are shown inline, then the wallet signs, and the receipt status with an explorer link follows.

**Swap.** Pool key = native ETH (`currency0`, zero address) / COMPUTE (`currency1`), fee 3000,
tick spacing 60, no hook, per the attested manifest. Price and liquidity come from `StateView`;
quotes use the quoter's `quoteExactInputSingle` via simulation; the swap calls the Universal
Router `execute(0x10, [abi.encode(0x060c0f, [ExactInputSingleParams, SETTLE_ALL, TAKE_ALL])],
deadline)`. ETH-in sends `amountIn` as value; COMPUTE-in shows two explicit steps, `approve(permit2)`
on the token and Permit2 `approve(token, universalRouter, amount, expiration)`, before the swap.
All router, quoter, StateView and Permit2 addresses come from the manifest's
`network.uniswapV4` block at runtime.

## Validation

See [`../docs/frontend-validation.md`](../docs/frontend-validation.md) for the build, typecheck
and test results, the Vercel Web Interface Guidelines review, the manifest verification and the
list of behaviour that was **not** exercised on the live chain (no real transactions were
broadcast, and no browser could be launched on the build worker).
