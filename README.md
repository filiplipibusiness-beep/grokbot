# GROKBOT 3.0 FINAL — Solana paper trading

Browser-only Solana market scanner and **virtual-money** trading simulator. No wallet connection, signing, blockchain transactions or real-money orders. The score is a heuristic, **not AI** and not a prediction of profit. Memecoins may lose all their value.

## Install on GitHub Pages (iPhone compatible)

Copy `index.html`, `app.js`, `style.css` and `README.md` to the root of your GitHub repository (not the ZIP itself). In Settings → Pages choose **Deploy from a branch**, `main`, `/ (root)` and save. Open `https://YOUR-USERNAME.github.io/grokbot/`. GitHub Pages hosts a static site only; it cannot run the bot continuously in the background.

**Before replacing an existing version:** Export your trade CSV and historical JSON. The app retains the `grokbot-v1` localStorage key so existing paper positions and history can remain available **on the same browser and site origin**. Never upload private keys or API credentials. Keep a backup of the prior source files.

## What changed in 3.0

- Automatic entries require: heuristic score above your configured threshold, at least 80% indicator coverage, liquidity >= $50,000, 24h volume >= $20,000, no flagged scoring risks, at least four valid price observations covering >= 2 minutes, a modest positive trend (0.5%–12%), and a non-declining final tick. A sold token has a six-hour re-entry cooldown. **These checks do not prove that a token is safe** and cannot reliably detect rug pulls or honeypots.
- Open positions are independently refreshed by token address, and missing/stale quotes block new trades. Stop loss/take profit only execute when the browser is open and an updated quote arrives; execution at the threshold price is **not guaranteed**.
- Portfolio equity and open PnL use conservative estimated liquidation value after modeled 0.25% fee and 0.50% slippage per side. Real market impact can be far worse, especially in thin pools.
- Backtest uses a shared chronological cutoff across tokens, evaluates the previous tick's score and trend and enters at the following tick (no same-tick signal execution). Open positions are marked to estimated liquidation value at period end. Results are **not** a live-execution forecast, do not fully reproduce all live filters, and per-token drawdowns are not a portfolio drawdown.
- API errors disable automatic trading until the user restarts it. Automatic trading is disabled on each new page load.

## Limitations

Discovery uses public DEX Screener latest token profiles and boosts, **not** an exhaustive Solana or Pump.fun token feed. API prices may be delayed or untradeable; API requests may fail or be rate-limited. Snapshots are only collected while the page is active, generally every 60 seconds, and stored locally (capped to 2000 per token and 150 tokens). iOS may suspend background tabs. Browser storage may be cleared or exhausted. The simulator does not account for gas, MEV, liquidity changes, transaction failures, taxes, chain outages or actual executable pool depth. The backtest is exploratory and uses short, sparse snapshots, so avoid optimizing parameters on tiny holdout samples.

## Tests

With Node.js 20+: `node --check app.js` and `node tests/smoke.test.cjs`. Tests are local logic smoke checks; they do not validate live DEX Screener API behavior or browser compatibility on every device.
