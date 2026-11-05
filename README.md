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

## GROKBOT 2.0 – bezpečnostní aktualizace (paper trading)

- Ceny otevřených pozic se dotazují zvlášť podle adres tokenů, nezávisle na seznamu objevených tokenů.
- Cenová data starší než 90 sekund se nepoužijí k novým obchodům ani k automatickému uzavření.
- Při spuštění stránky je automatický bot vždy pozastaven, dokud ho uživatel výslovně nezapne.
- Denní ochrana zahrnuje realizovaný denní PnL a aktuální nerealizovaný PnL otevřených pozic (konzervativní aproximace; otevřené PnL může pocházet i z předchozích dní).
- Paper nákup a prodej počítá s modelovým skluzem 0,5 % a poplatkem 0,25 % na každé straně. Skutečné náklady se mohou výrazně lišit.
- Backtest používá stejné modelové náklady. Stále jde o zjednodušený backtest jednotlivých tokenů, **nikoli** realistickou simulaci společného portfolia.
- Testy: `node tests/smoke.test.cjs` (Node.js 18+). Kontrola syntaxe: `node --check app.js`.

**Omezení:** Projekt zůstává čistě klientskou webovou aplikací. Neposkytuje nepřetržitý běh na pozadí, nepoužívá on-chain audit tokenů a nedokáže garantovat exekuci stop-lossu během výpadku API. Nejde o živé obchodování ani o AI predikční model. Původní klíč `localStorage` zůstává zachován pro kompatibilitu se stávajícími daty. Před aktualizací doporučujeme exportovat historii.
