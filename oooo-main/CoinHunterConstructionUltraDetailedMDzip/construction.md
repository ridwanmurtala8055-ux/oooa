# Coin Hunter — Construction.md (Ultra Detailed)
Version: 2.0 (Ultra Detailed)
Last updated: 2026-02-15
Stack: TypeScript (Node.js), PostgreSQL, Telegram Bot (Telegraf/grammY), Solana Execution (Jupiter v6 primary, Raydium fallback, optional Jito/private relay), Forex Execution (MT4/MT5 EA bridge)
Custody model: **Custodial** (server stores encrypted private keys)

---

## 0) What this document is
This is the **source of truth** for how Coin Hunter must work:
- **Feature 1 (Free): Terminal** (Trojan-like buy/sell UX and tools)
- **Feature 2 (Paid): Meme Bot** (Launch Sniper + Single Meme Pullback)
- **Feature 3 (Paid): Forex Bot** (Session-based hybrid strategy via MT4/MT5 EA bridge)
- Subscriptions (Meme $100, Forex $100, Bundle $170)
- Risk engine, profit buffer, security, database model, state machines, commands, and Telegram screen map.

> Implementation rule: **Telegram is UI only**. All decisions, risk, and execution logic live server-side.

---

## 1) System overview

### 1.1 Services
Coin Hunter runs as a **single deployable system** (can be split later):
- **Telegram Bot**: menu/UI, collects user inputs, shows status, never executes trades directly.
- **API Core**: user/accounts/subscriptions/entitlements/profiles/risk/audit/payments; serves internal APIs.
- **Solana Engine**: terminal swaps + meme strategies; listens to streams; executes swaps through Jupiter/Raydium/Jito.
- **Forex Engine**: strategy engines + EA bridge endpoints + risk enforcement.
- **PostgreSQL**: durable storage for users, wallets, profiles, orders, positions, logs.
- (Optional) **Redis**: locks, rate limits, queues (recommended but not mandatory in v1).

### 1.2 High-level data flow
```
Telegram UI → API Core → (Solana Engine | Forex Engine) → Execution → DB
                                  ↑                 ↑
                                  └──── Risk + Entitlement checks ────┘
```

### 1.3 Global non-negotiables
- **Custodial keys encrypted at rest**; decrypted only for signing.
- **Subscription gates** checked before any premium entry.
- **Risk gates** checked before *any* trade (even free terminal if you want safety).
- **Idempotency** on trade execution: retries must never double-buy by accident.
- **Audit everything**: every button press that changes state → audit_logs.

---

## 2) Feature catalog

### 2.1 Feature 1 — Terminal (Free, Trojan-like)
Terminal is a high-speed Solana trading terminal inside Telegram:
- Custodial wallet management (multi-wallet, withdraw, export optional)
- Buy/Sell flows with presets, slippage, execution mode, shield/MEV protect, confirm-trade toggle
- Positions view, Orders (Limit + DCA), basic Sniper, basic Copy-trade, settings, security

> “Trojan-like” requirement: **same functional screens and interaction style**, but Coin Hunter text/branding.

### 2.2 Feature 2 — Meme Bot (Paid)
Includes:
- **Launch Sniper**: detect new launches (DEX pools + pump.fun migration + Jupiter route + volume rules) → filters → probe test → buy → manage exits.
- **Single Meme Pullback**: one-token adaptive pullback scalper; Auto mode + Manual entry with bot-managed exits.
- Shared risk systems: hybrid sizing, min trade size, position caps, profit buffer, TP/SL toggle disclaimers + safety overrides.

### 2.3 Feature 3 — Forex Bot (Paid)
- MT4/MT5 EA installed on user terminal executes trades.
- EA polls server; server returns NO_SIGNAL or SIGNAL if subscription active and risk ok.
- Adaptive session-based deterministic engines (Asia range, London breakout, NY continuation).
- Broad instrument universe (FX + Gold + Indices) with strict position limits + correlation guard.
- AI planned as Phase 2 (regime classifier + bounded risk modulation + trade quality score).

---

## 3) Custodial wallet security design (Solana)

### 3.1 Key storage
- Store private keys encrypted in DB.
- Use envelope encryption:
  - `encrypted_private_key = AES-256-GCM( master_key, raw_private_key, nonce, aad )`
  - `aad` includes wallet_id + user_id to prevent ciphertext swapping.
- Master key comes from environment (never in DB): `WALLET_MASTER_KEY`.

**Fields**
- nonce/iv stored alongside ciphertext
- auth tag stored (GCM)

### 3.2 Action PIN (Vault PIN)
- User sets PIN (4–8 digits recommended).
- Store `pin_hash = argon2id(pin + per-user-salt)`.
- PIN required for sensitive actions:
  - Withdraw
  - Export keys (if allowed)
  - Import wallet (if allowed)
  - Disable Confirm Trades (optional)
  - Disable critical protections (premium toggles)

### 3.3 Signing workflow
1) Telegram request reaches API Core.
2) API Core checks entitlements + risk.
3) Solana Engine requests wallet key material:
   - Fetch encrypted key from DB
   - Decrypt in memory
   - Build & sign transaction
   - Zero memory buffers after use (best effort)

---

## 4) Solana execution layer (Jupiter primary, Raydium fallback, Jito optional)

### 4.1 Jupiter v6 primary path
**Goal**: always try Jupiter first for best route and simplicity.

**Step-by-step swap (Buy/Sell)**
1) **Quote**
   - Input: `inputMint`, `outputMint`, `amount`, `slippageBps`
   - Output: route plan, expectedOut, price impact, fees

2) **Swap transaction build**
   - Provide user public key, quote, and preferences:
     - `wrapAndUnwrapSol`
     - `computeUnitPriceMicroLamports` (priority fee)
     - `asLegacyTransaction` (optional)

3) **Simulate (recommended)**
   - If simulation fails → attempt fallback or adjust parameters (once).

4) **Send**
   - Standard RPC send OR private relay send (Jito).
   - Track signature → confirm with commitment `confirmed`.

5) **Finalize**
   - Record tx in DB
   - Update positions/trade logs
   - Notify Telegram UI with state updates.

### 4.2 Raydium fallback path
Used when:
- Jupiter has no route (too new)
- Jupiter swap build fails
- Jupiter route exists but repeatedly errors

Fallback steps:
- Identify Raydium pool for mint (via on-chain accounts / known program IDs).
- Build swap instruction directly:
  - calculate minOut from slippage
  - set compute budget + priority fee
- Simulate → send → confirm
- Log identical to Jupiter path.

### 4.3 Jito / private relay (Shield Mode)
If Shield Mode enabled:
- Send tx via private relay/bundle to reduce sandwiching.
- If private send fails → optionally fall back to public send (configurable).

### 4.4 Execution modes
User-facing modes (Terminal):
- Normal: default computeUnitPrice
- Fast: higher computeUnitPrice
- Turbo: even higher computeUnitPrice
- Custom: user sets fee

Internal mapping:
- `computeUnitLimit` + `computeUnitPriceMicroLamports`
- optional tip to relay

---

## 5) Feature 1 — Terminal behavior (exact Trojan-like flows)

### 5.1 Main Dashboard (Terminal Home)
Shows:
- Active wallet label + address
- SOL balance
- quick actions (Buy/Sell/Positions/Orders)

Buttons:
- Buy, Sell
- Positions, Orders
- Sniper, Copy Trade
- Wallets, Settings
- Help

### 5.2 Buy flow (Token paste → buy)
State machine:
1) **BUY_INPUT**
   - User pastes mint
   - Validate; load token info
2) **BUY_PANEL**
   - Preset SOL amount buttons + Custom amount
   - Shows: slippage, execution mode, shield, confirm toggle
3) **BUY_CONFIRM** (only if confirm enabled)
4) **BUY_EXECUTING**
   - Quote → build → simulate → send → confirm
5) **BUY_RESULT**
   - success: tx link + position snapshot
   - failure: error reason + retry option

**Important Terminal defaults**
- Confirm Trades: ON by default (you can match Trojan defaults)
- Slippage: default buy slippage (configurable)
- Shield: OFF by default (user toggles)
- Execution mode: Normal by default

### 5.3 Sell flow (Positions → choose token → sell %)
State machine:
1) POSITIONS_LIST
2) TOKEN_DETAIL / SELL_PANEL
   - % presets (25/50/75/100) + custom
   - sell slippage, shield, confirm
3) SELL_CONFIRM (if enabled)
4) SELL_EXECUTING
5) SELL_RESULT

### 5.4 Presets & settings screens
Terminal provides:
- Buy preset editor (5 slots)
- Sell preset editor (4 slots)
- Slippage editor (buy/sell)
- Execution mode selector
- Shield mode toggle
- Confirm trades toggle
- Language + Simple/Advanced mode

### 5.5 Orders (Limit + DCA) (Terminal utility)
- Limit orders: create / list / cancel
- DCA: create / list / cancel
These are **utility** in Feature 1; advanced strategy belongs to Feature 2.

### 5.6 Basic Sniper (Terminal)
- Toggle on/off
- amount + slippage + fee
- optional autosell toggle
- migration sniper option
This is “basic”; Feature 2 Launch Sniper is “smart sniper”.

### 5.7 Copy trade (Terminal)
- Add wallet to follow
- set sizing (fixed or %)
- pause/resume
- logs

---

## 6) Feature 2 — Meme Bot (Paid)

### 6.1 Shared constraints & risk
- Entitlement required: `meme_pro=true` and subscription active.
- Minimum trade size: **>$10**
- Position limits:
  - Launch: max 2 concurrent
  - Pullback: max 1 concurrent
  - Global meme: max 3 and exposure cap
- Hybrid sizing:
  - `sizeUsd = max(10, equityUsd * riskPct)` with caps
- Profit Buffer (default ON, toggleable):
  - profits moved to reserve, excluded from sizing
- TP/SL toggles allowed, but:
  - emergency exits + daily loss cap + exposure cap + TTL minimum cannot be disabled

### 6.2 Launch Sniper (smart)
**Goal**: snipe “real” launches only (filters + volume confirmation).

#### 6.2.1 Detection sources (ALL)
A candidate is created if any trigger fires:
1) DEX pool creation + liquidity add
2) pump.fun migration
3) Jupiter route appears (confirmation)
4) volume rule satisfied

#### 6.2.2 Volume confirmation (mandatory)
Candidate must have:
- ≥ X buys within Y seconds
- ≥ minimum total volume
- ≥ N unique buyers

#### 6.2.3 pump.fun special “social proof”
For pump.fun candidates:
- wait for **2 unique buys + dev buy** (where identifiable) before entering.

#### 6.2.4 Social handle check
If enabled in profile:
- require links: website/X/telegram (strictness configurable)
- show reason codes if missing

#### 6.2.5 Hard filters
- min liquidity
- mint authority (optional)
- freeze authority must be off (critical)
- top holders concentration max
- blacklist checks

#### 6.2.6 Probe test (anti-honeypot)
- probe buy small amount
- probe sell small amount
- if sell fails or tax/limits extreme → abort + cooldown.

#### 6.2.7 Entry execution
- Jupiter primary, Raydium fallback
- use Shield/private relay if enabled
- idempotency per candidate to prevent double-buys

#### 6.2.8 Exit engine (Launch)
Priority order:
1) Emergency liquidity rug exit
2) Hard SL
3) Trailing stop
4) TP (partial/full)
5) TTL exit

Sell-fail escalation:
- one retry with higher fee + wider slippage
- then stop + alert/log

State machine:
DETECTED → FILTERING → PROBE_BUY → PROBE_SELL → MAIN_BUY → MONITOR → EXIT → COMPLETE

### 6.3 Single Meme Pullback Scalper
**Goal**: repeatedly trade 1 token via pullback-in-uptrend.

Dual modes:
- Auto: bot enters + exits + re-enters
- Manual entry: user buys, bot manages exits

Internal adaptive logic (hidden):
- regime classification (calm/active/hyper) using volatility/volume/spread metrics
- adapts pullback depth, confirmation strength, TTL, trailing width
User sees only: risk preset + TP/SL + mode.

State machine:
WAIT_TREND → WAIT_PULLBACK → BOUNCE_CONFIRMED → BUY → MONITOR → EXIT → COOLDOWN → WAIT_TREND

---

## 7) Feature 3 — Forex Bot (Paid)

### 7.1 Execution via EA bridge (MT4/MT5)
- EA installed on user terminal.
- EA polls server every N seconds.
- Server returns NO_SIGNAL if:
  - subscription expired
  - risk limits hit
  - correlation rules block
- EA executes trades locally with broker credentials (never shared with Coin Hunter).

### 7.2 Instruments (broad list) + strict limits
Universe includes:
- FX majors/minors
- Metals (XAUUSD)
- Indices (US30, NAS100, SPX500, etc.)

Position limits:
- Default max open positions: 2
- Hard cap: 3 (Aggressive only)
- Per-class caps: metals max 1, indices max 1
- Correlation guard prevents stacking similar USD exposures.

### 7.3 Strategy: adaptive session-based hybrid (deterministic)
- Asia: range engine
- London: breakout engine
- NY: continuation engine

Profit objective: **Moderate growth with controlled volatility**
- base risk ~ 1% per trade
- average R:R around 1:1.5
- daily drawdown cap ~ 5%
- 3 consecutive losses → pause

### 7.4 AI assistance (Phase 2)
AI cannot generate trades.
AI can:
- classify regime
- modulate risk within bounds (0.6–1.2%)
- score trade quality to skip trades
AI cannot override safety locks.

### 7.5 EA protocol (example)
EA → server poll:
- terminal_id
- token
- account_number
- equity
- open_positions summary

Server → EA:
- NO_SIGNAL
or
- SIGNAL:
  - symbol, side, lot, sl, tp, idempotency_id, expires_at

EA → server report:
- idempotency_id
- broker_ticket
- filled price/time
- errors if any

---

## 8) Subscription & payments (money to your wallet)

### 8.1 Plans
- Terminal: free
- Meme Pro: $100/mo
- Forex Pro: $100/mo
- Bundle: $170/mo

### 8.2 Entitlements
Computed by plan + active_until:
- terminal: true
- meme_pro: true if plan in (meme,bundle) and active
- forex_pro: true if plan in (forex,bundle) and active

### 8.3 Enforcement behavior
- Expired: block new entries immediately.
- Recommended: keep managing exits for open positions to avoid trapping users.

### 8.4 Payments model
Payments go to your wallet address.
System supports:
- payment hash submission + verification
- or unique memo/reference codes per user
Upon verification:
- create payment record
- activate subscription by extending active_until

---

## 9) Global risk engine (shared principles)

### 9.1 Meme risk (Solana)
- min trade > $10
- max concurrent positions caps
- exposure cap (e.g., 70% tradable capital)
- daily loss cap
- kill switch

### 9.2 Forex risk
- max open positions
- portfolio risk cap
- correlation guard
- spread filter
- news lockout
- daily DD cap

### 9.3 Profit buffer (meme default ON)
- Trading capital + reserve buffer
- sizing uses trading capital only
- user can toggle compounding

---

## 10) PostgreSQL schema (minimum viable)

### 10.1 Core tables
- users(id, telegram_id, status, created_at)
- security_pins(user_id, pin_hash, created_at)
- subscriptions(id, user_id, plan, status, active_until, created_at, updated_at)
- payments(id, user_id, amount_usd, method, reference, status, created_at)
- wallets(id, user_id, label, pubkey, enc_privkey, enc_iv, enc_tag, is_active, created_at)

### 10.2 Profiles
- terminal_settings(user_id, buy_slippage_bps, sell_slippage_bps, exec_mode, shield_enabled, confirm_trades, presets_json, updated_at)
- meme_sniper_profiles(...)
- meme_pullback_profiles(...)
- forex_profiles(...)
- ea_terminals(id, user_id, platform, terminal_id, token_hash, status, last_seen_at)

### 10.3 Trades & positions
- sol_trades(id, user_id, wallet_id, mint, side, amount_in, amount_out, txid, status, created_at)
- sol_positions(id, user_id, wallet_id, mint, qty, entry_price, status, opened_at, closed_at, pnl_usd)
- forex_signals(...)
- forex_positions(...)

### 10.4 Logs
- audit_logs(id, user_id, action, payload_json, created_at)
- engine_events(id, user_id, engine, level, message, payload_json, created_at)

---

## 11) Telegram commands & callbacks (summary)

### 11.1 Slash commands (public)
/start, /menu, /buy, /sell, /positions, /orders, /sniper, /copy, /wallet, /settings, /security, /subscribe, /help

### 11.2 Premium slash commands
/meme, /forex, /launch, /pullback, /bind

### 11.3 Inline callback actions (examples)
btn_buy, btn_sell, buy_execute, sell_execute, wallet_create, wallet_withdraw, sniper_toggle, copy_add_wallet, etc.

---

## 12) Telegram Screen Map (Feature 1 core)

### 12.1 Screen IDs
- SCREEN_MAIN
- SCREEN_BUY_INPUT
- SCREEN_BUY_PANEL
- SCREEN_BUY_SETTINGS
- SCREEN_BUY_SLIPPAGE
- SCREEN_EXECUTION_MODE
- SCREEN_SHIELD_MODE
- SCREEN_BUY_PRESETS
- SCREEN_POSITIONS
- SCREEN_SELL_PANEL
- SCREEN_SELL_SETTINGS
- SCREEN_SELL_SLIPPAGE
- SCREEN_ORDERS_MAIN
- SCREEN_LIMIT_ORDERS
- SCREEN_DCA_ORDERS
- SCREEN_SNIPER_MAIN
- SCREEN_COPY_MAIN
- SCREEN_WALLET_MAIN
- SCREEN_WITHDRAW_FLOW
- SCREEN_SECURITY_MAIN
- SCREEN_SETTINGS_MAIN

### 12.2 Navigation rules
- Every screen has Back.
- Back returns to the logical parent screen.
- Any state-changing action writes audit_logs.

---

## 13) Deployment (same server)

### 13.1 Docker compose (recommended)
- postgres container
- api-core container
- bot-telegram container
- engine-solana container
- engine-forex container

### 13.2 Secrets
- DATABASE_URL
- WALLET_MASTER_KEY
- PIN_HASH_PEPPER
- TELEGRAM_BOT_TOKEN
- RPC endpoints (private)
- Jito/private relay creds (if used)

---

## 14) Definition of done
Coin Hunter v1 is “done” when:
- Terminal buy/sell works end-to-end with Jupiter + fallback + logs
- Meme Launch Sniper executes with filters + probe + exits
- Meme Pullback trades one token in auto + manual exit mode
- Forex EA bridge returns signals gated by subscription + risk
- Subscription activation and expiry gates work
- Postgres migrations run cleanly and schema is stable
- Audit logs capture all critical actions

---

END.
