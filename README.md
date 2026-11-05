# GROKBOT v1.0
Static browser-only Solana memecoin scanner and paper trading terminal.

## Deployment
Upload `index.html`, `style.css`, and `app.js` to a GitHub repository root, then enable GitHub Pages → Deploy from a branch → main / (root). No build or API keys needed.

## Data and constraints
- Public DEX Screener latest token profiles + latest boosts discovery, then `/tokens/v1/solana/{addresses}` market pairs. Discovery is NOT a complete Pump.fun new-token feed and may contain older tokens.
- Market scoring is a transparent weighted heuristic, **not an AI model**. Market-cap momentum uses 24h price change as an explicitly labeled proxy; actual historical market cap is not provided.
- Auto trading runs only while the page is active, with 60-second polling subject to browser throttling and API limits. No wallet, real orders, or transaction signing.
- Paper execution uses last observed market price with **zero fees and slippage**. Thin pools may make simulated results highly unrealistic. Stale prices are displayed but never used for new closes.
- Positions for tokens no longer in the discovery set cannot update or close until the token reappears. The browser-only implementation does not guarantee continuous coverage.
- Snapshots are localStorage-only and capped (2000 snapshots/token, 150 tokens). Browser data clearing deletes history and trades; export regularly.
- Backtesting is a minimal per-token chronological training/holdout split on actual recorded snapshots, with no optimization or walk-forward implementation in v1. No synthetic history. Open positions are excluded from realized PnL.
- Profit factor in the live account is not displayed in v1; see next milestones.

## Next modules
1. Reliable token-address watchlist and price refresh for open positions, even if discovery drops them.
2. Realistic execution model (fees, slippage, liquidity), and daily risk based on marked-to-market drawdown.
3. Backtest optimizer, profit factor, walk-forward validation and trade-by-trade exports.
4. Optional server-side continuous ingestion for 24/7 running (not possible with GitHub Pages alone).
