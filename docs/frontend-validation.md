# Frontend validation evidence

Date: 2026-09-25. Worker toolchain: Node 24.21.0, npm 11.19.0, Vite 7.3.6, TypeScript 5.9.3,
Vitest 3.2.4, viem 2.x, Foundry `cast` for cross-checks. Source lives in `web/`, the static export
in `dist/`, the handoff copies in `web/handoff/`.

## Handoff binding

| Check | Result |
| --- | --- |
| `docs/abi/SeatCompute.json` canonical Keccak (key-sorted, compact JSON) | `38880b8e…37bee` = handoff `abiHash` ✓ |
| `docs/abi/ComputeProject.json` canonical Keccak | `b4f18631…cfdc7` = handoff `abiHash` ✓ |
| Repository `HEAD` at build | `e58673e4d02b30e601364df34e7d75e495b82d30` = handoff `sourceCommit` ✓ |
| Sepolia `eth_chainId` via `https://ethereum-sepolia-rpc.publicnode.com` | `11155111` ✓ |
| Code at `0x3a7fd75f…426b` (SeatCompute) / `0x5ef94cfb…7a69` (ComputeProject) | 3421 / 541 hex chars, non-empty ✓ |
| Live reads | `name()` Seat Compute, `symbol()` COMPUTE, `totalSupply()` 10^27, `token()` = SeatCompute, `version()` 1, `siteLabel()` imd-compute ✓ |
| Uniswap v4 pool (ETH/COMPUTE, 3000, 60, no hook) id `0x30085333…4a432` | `StateView.getSlot0` sqrtPriceX96 ≈ 5.60e32 (≈ 5.0e7 COMPUTE/ETH), liquidity 177284; quoter answered 0.001 ETH → ≈ 49 627 COMPUTE ✓ |

The operator's keyed RPC does not serve Sepolia, so all chain checks used the public RPC URLs
from `network.json`.

## Build, typecheck, tests

```
npm run typecheck   → tsc -p tsconfig.json && tsc -p tsconfig.node.json: 0 errors
npm test            → 5 files, 43 tests passed (vitest, jsdom)
npm run build       → vite build: index.html 0.94 kB, CSS 9.9 kB, JS 266 + 288 + 12 kB
                      wrote dist/imd-deployment.json: 9 assets, 799 134 bytes
npm run verify:manifest → manifest ok
```

Test coverage (`web/src/**/*.test.ts(x)`), all against a mocked EIP-1193 wallet and a fake
JSON-RPC chain that answers `eth_call` by selector and records `eth_sendTransaction`:

- `lib/dashboard.test.ts` – join by deviceKey/tokenId, orphan contributors kept, online
  threshold, counters from strings, default `outputTokens` desc, every filter, numeric tokenId
  sort, URL-hash round trip, live-first loading, snapshot fallback on API failure, malformed
  responses.
- `lib/swap.test.ts` – pool key ordering, pool id equals `cast keccak(abi.encode(poolKey))`,
  `execute` args (`0x10`, actions `0x060c0f`, ExactInputSingleParams / SETTLE_ALL / TAKE_ALL
  payloads decoded back), ETH-in value, token-in direction, slippage, sqrtPrice conversion.
- `lib/deployment.test.ts` – manifest + ABI loading relative to a gateway subpath, ABI hash
  verification (tamper detected), rejection of bad version / traversal paths / network chain
  mismatch, `walletAddChain` derivation.
- `lib/wallet.test.ts` – switch success, 4902 → `wallet_addEthereumChain` with exact params →
  switch again, non-4902 errors propagate, EIP-6963 discovery and `window.ethereum` fallback.
- `App.test.tsx` (interaction) – reads render from the manifest RPC with explorer links; table
  sorted/filtered/searched with hash sync; API failure state; connect → wrong-chain "Switch to
  Sepolia" → add-chain flow → gate cleared and balance shown; 2 seats highlighted for the
  connected wallet, recomputed on `accountsChanged`, cleared on disconnect; transfer validation,
  simulate → sign → receipt → explorer link, revert reason surfaced with nothing sent; approve
  "max"; ETH→COMPUTE quote (49 627 COMPUTE, minimum after 1 % slippage) and router `execute`
  with value 10^15 wei; COMPUTE→ETH requiring token approve then Permit2 approve before the
  swap enables; quote revert reason shown; transactions disabled when the RPC chain differs
  from the manifest.

## Static hosting check

`dist/index.html` references only `./assets/*` and `./favicon.svg`. A scratch HTTP server that
mounted `dist/` under `/ipfs/QmFakeCid/` returned 200 for every referenced asset,
`imd-deployment.json`, both ABI files and `data/snapshot.json` when resolved relative to the
page. The manifest was re-verified with an independent Python script: identifiers, contract set
and network block equal the handoff (`network` key order preserved), every file except the
manifest is listed, all SHA-256 values match and are lowercase, no path is absolute or
traverses upward, and each exported ABI re-hashes to its `abiHash`.

## Vercel Web Interface Guidelines review

Source: `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md`,
retrieved 2026-09-25 (190 lines). Reviewed files: `web/index.html`, `web/src/App.tsx`,
`web/src/components/{WalletBar,DeploymentPanel,Dashboard,TokenActions,SwapPanel,TxStatus}.tsx`,
`web/src/styles.css`.

Findings fixed before the final build:

- `web/src/components/SwapPanel.tsx:367` – button copy "Allow router" → Title Case "Allow Router".
- `web/src/components/DeploymentPanel.tsx:228` – link "View on explorer" → "View on Explorer".
- `web/src/components/TxStatus.tsx:34` – link "View transaction" → "View Transaction".
- `web/src/components/WalletBar.tsx:93` – "Check again" → "Check Again".
- `web/src/App.tsx:88` – error heading → Title Case.
- `web/src/components/Dashboard.tsx` – table rows > 50: added pagination (50/100/250/1000) and
  `content-visibility: auto` on rows (`styles.css:625`); filter/sort/search state synced to the
  URL hash; `aria-sort` on sortable headers; empty-state row.
- `web/src/components/TokenActions.tsx`, `SwapPanel.tsx` – inline field errors tied with
  `aria-describedby`/`aria-invalid`, `inputMode="decimal"`, `autoComplete="off"`,
  `spellCheck={false}` on address fields, action described before confirmation.
- `web/src/styles.css` – `:focus-visible` ring everywhere (`outline: none` only with the ring
  replacement), `touch-action: manipulation` on buttons/labels, `-webkit-tap-highlight-color`,
  `prefers-reduced-motion` guard, explicit transition properties (no `transition: all`),
  `tabular-nums` for numeric cells, `text-wrap: balance` on headings, `overflow-wrap: anywhere`
  on hashes/addresses, `min-width: 0` on flex/grid children, safe-area padding, `color-scheme:
  dark` + matching `theme-color`, explicit `<select>` colours.
- `web/index.html` – `<link rel="preconnect" href="https://api.imd.fun">`, `color-scheme` and
  `theme-color` metas, no zoom restrictions.
- Accessibility: skip link to `<main>`, single `<h1>` → `<h2>` cards → `<h3>` forms, every
  input wrapped in a `<label>`, decorative glyphs `aria-hidden`, wallet icons `alt=""` with
  dimensions, `aria-live="polite"` on balance, quote, tx status, linked chip and result counts,
  `role="alert"` for errors, `translate="no"` on addresses/symbols/hashes, `Intl.*` for all
  numbers, dates and relative times.

Remaining limitations / intentional deviations:

- Submit buttons are disabled while prerequisites are unmet (wrong chain, unverified code,
  invalid input). The guideline prefers enabled submits; contract safety takes precedence.
- Numeric amount placeholders ("e.g. 12.5") do not end with "…" because a trailing ellipsis
  reads as a truncated number.
- Irreversible actions (transfer, swap) rely on the wallet's own confirmation dialog plus the
  on-page description of the pending action; no additional in-app confirmation modal.
- Amount inputs are controlled (needed for live quoting/validation); the per-keystroke work is
  a parse and, for the swap, a debounced simulate call.
- Not applicable: images/video, drag gestures, modals/drawers, SSR hydration.

## Not validated on this worker

- **No browser session.** The bundled Playwright Chromium and headless shell fail to start
  (`libatk-1.0.so.0`, `libgbm.so.1`, `libasound.so.2` … missing; no root to install them), so no
  screenshot, console or overflow inspection at mobile/desktop widths was performed. Interaction
  coverage comes from the jsdom suite above; responsive rules were reviewed in CSS only
  (`.kv` collapses to one column below 480 px, the table scrolls horizontally inside its
  container, filters wrap, the two-column grid collapses below ~380 px per column).
- **No real transactions.** Transfer, approve, Permit2 approve and Universal Router `execute`
  were simulated and encoded against a fake chain, not broadcast on Sepolia. The quoter call
  and the pool reads were exercised against the live chain with `cast` only.
- **Real wallets.** Only the mocked provider was used; MetaMask/Rabby/Coinbase behaviour for
  `wallet_addEthereumChain` (some wallets switch as part of add, which the code tolerates) was
  not tested live.
- **API CORS.** `api.imd.fun` returned no `Access-Control-Allow-Origin` for a foreign origin at
  build time; the snapshot fallback covers that case, but the live path from an IPFS gateway
  origin could not be observed without a browser.
- The optional mainnet `ownerOf` lookup was not exercised: every contributor in the live payload
  has a wallet.
