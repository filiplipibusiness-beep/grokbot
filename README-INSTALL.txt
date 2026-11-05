GROKBOT – scheduled paper trading

1. Upload bot-runner.cjs to the repository root (main branch).
2. Replace .github/workflows/grokbot.yml with the supplied workflow.
3. In GitHub Settings > Actions > General > Workflow permissions, enable Read and write permissions if required by your repository settings.
4. Run the workflow manually in Actions > GROKBOT Paper Scheduler > Run workflow.
5. Check the run log and bot-state.json in the repository. The first run starts a NEW independent $10,000 simulated account.

IMPORTANT:
- No real trades, wallet, or blockchain write calls.
- The existing browser app.js remains independent and uses localStorage; its balances and trades will NOT sync to bot-state.json yet.
- This is periodic (best effort) GitHub Actions execution, not uninterrupted 24/7 execution.
- A scheduled run can be delayed or skipped; stop losses are checked only when runs execute.
- State is committed to the repository. In a public repo, simulated positions, balances and history are public.
- If branch protection prevents pushes, the workflow cannot persist its state.
- Never upload private keys or wallet secrets.
