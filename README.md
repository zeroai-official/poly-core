# poly-core

A pure TypeScript backend interface that abstracts core workflows from the official Polymarket Builder + Safe example (no React, no Next.js, no localStorage).

- **Unified remote signing**: All builder signing operations are performed through your deployed remote signing server (Builder keys are never stored within this package).
- **Dual runtime support**:
  - Chrome wallet (frontend/extension): Caller provides browser wallet `ethers` signer
  - Self-hosted quant backend: Caller provides `ethers.Wallet` signer

---

## API Reference

### 1) Trading Core: `PolymarketTradingKit`
Entry point: `poly-core/src/kit.ts`

#### Constructor
- `new PolymarketTradingKit({ config, eoaAddress, signer })`

`config` options:
- `rpcUrl` (required): Polygon RPC URL
- `remoteSigning.url` (required): Remote signing server URL
- `remoteSigning.token` (optional): Remote signing server authentication token
- `chainId` (optional, default: 137)
- `clobApiUrl` (optional, default: `https://clob.polymarket.com`)
- `relayerUrl` (optional, default: `https://relayer-v2.polymarket.com/`)
- `fetchFn` (optional): Custom `fetch` function if runtime lacks `globalThis.fetch` (e.g., older Node.js versions)

#### Trading Session (Orchestration Flow)
- `initializeTradingSession({ onProgress?, autoDeploySafe? })`
  - Initializes RelayClient
  - Derives Safe address
  - Checks if Safe is already deployed (via RPC bytecode check)
  - Deploys Safe if necessary
  - Retrieves/creates User API Credentials (CLOB)
  - Checks approvals and batch sets them if insufficient
  - Returns `{ eoaAddress, safeAddress, apiCredentials, approvals }`

#### Safe Operations
- `deriveSafeAddress()`
- `isSafeDeployed(safeAddress)`
- `deploySafe(relayClient)`

#### Relay / Relayer
- `createRelayClient()`

#### CLOB Client
- `createClobClient({ apiCredentials, safeAddress })`

#### Trading Operations (Order Management)
- `createLimitOrder(clobClient, req)`
  - Supports `GTC` / `GTD`
  - When `req.isMarketOrder=true`: Fetches orderbook price via `getPrice` and submits an "aggressive limit order" (pseudo market behavior)
  - `req.mode="auto"` (default): if needed, resolves `tick_size + neg_risk` via a single `getOrderBook(tokenId)` call (cached)
- `createMarketOrder(clobClient, req)`
  - Supports `FOK` / `FAK` market-style semantics
  - BUY uses `amountUsdc`, SELL uses `amountShares`
  - `req.mode="auto"` (default): if needed, resolves `tick_size + neg_risk` via a single `getOrderBook(tokenId)` call (cached)
- `cancelOrder(clobClient, orderId)`
- `getOpenOrders(clobClient)`
- `getBestBidAsk(clobClient, tokenId)`

#### Redemption (CTF redeem)
- `redeemPosition(relayClient, { conditionId, outcomeIndex })`

---

### 2) Data APIs: `PolymarketDataClient`
Entry point: `poly-core/src/data.ts`

- `listHighVolumeMarkets(limit)`: Fetches via `gamma-api.polymarket.com`
- `getMarketByTokenId(tokenId)`: Fetches via `gamma-api.polymarket.com`
- `getPositions(user)`: Fetches via `data-api.polymarket.com`

---

### 3) Approvals
Entry point: `poly-core/src/approvals.ts`

- `checkAllApprovals({ rpcUrl, safeAddress, threshold? })`
- `createAllApprovalTxs()`: Generates batch approval transactions for `relayClient.execute()`

---

### 4) Redeem Transaction Builder
Entry point: `poly-core/src/redeem.ts`

- `createRedeemTx({ conditionId, outcomeIndex })`

---

## Usage Examples

> Note: The examples below demonstrate usage patterns only. Replace `remoteSigning.url/token` with your actual remote signing server configuration.

### Example A: Self-Hosted Quant Backend (Node.js)

```ts
import { ethers } from "ethers";
import {
  PolymarketTradingKit,
  PolymarketDataClient,
} from "poly-core";

const rpcUrl = process.env.POLYGON_RPC_URL!;
const remoteSigningUrl = process.env.POLYMARKET_BUILDER_URL!;
const remoteSigningToken = process.env.POLYMARKET_AUTHORIZATION_TOKEN!;

const privateKey = process.env.TRADER_PRIVATE_KEY!;
const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
const signer = new ethers.Wallet(privateKey, provider);

const eoaAddress = (await signer.getAddress()) as `0x${string}`;

const kit = new PolymarketTradingKit({
  config: {
    rpcUrl,
    remoteSigning: {
      url: remoteSigningUrl,
      token: remoteSigningToken,
    },
  },
  eoaAddress,
  signer,
});

const session = await kit.initializeTradingSession({
  onProgress: (e) => {
    console.log(`[${e.step}] ${e.message}`);
  },
});

const clobClient = kit.createClobClient({
  apiCredentials: session.apiCredentials,
  safeAddress: session.safeAddress,
});

const order = await kit.createLimitOrder(clobClient, {
  tokenId: "0x...",
  side: "BUY",
  size: 10,
  isMarketOrder: true,
  // mode defaults to "auto"
});

console.log("Order ID:", order.orderId);

const dataClient = new PolymarketDataClient({});
const positions = await dataClient.getPositions(session.safeAddress);
console.log("Positions:", positions.length);
```

### Example B: Chrome Wallet / Browser (Caller provides signer)

```ts
import { ethers } from "ethers";
import { PolymarketTradingKit } from "poly-core";

// EIP-1193 provider from browser wallet
const ethereum = (globalThis as any).ethereum;
if (!ethereum) throw new Error("Wallet not found");

const provider = new ethers.providers.Web3Provider(ethereum);
await provider.send("eth_requestAccounts", []);
const signer = provider.getSigner();

const eoaAddress = (await signer.getAddress()) as `0x${string}`;

const kit = new PolymarketTradingKit({
  config: {
    rpcUrl: "https://polygon-rpc.com",
    remoteSigning: {
      url: "https://your-remote-signing-server/sign",
      token: "your-token",
    },
  },
  eoaAddress,
  signer,
});

const session = await kit.initializeTradingSession();
const clobClient = kit.createClobClient({
  apiCredentials: session.apiCredentials,
  safeAddress: session.safeAddress,
});

await kit.createLimitOrder(clobClient, {
  tokenId: "0x...",
  side: "SELL",
  size: 5,
  price: 0.62,
  // mode defaults to "auto"
});
```

---

## Notes

- This package does not perform any session persistence (localStorage/cookie/database). Business logic should handle storing `apiCredentials` and `safeAddress`.
- `createLimitOrder(..., { isMarketOrder: true })` implementation uses an "aggressive limit order" strategy, not a true on-chain market order.
- Currently defaults to Polygon mainnet (chainId=137) as the target chain.
