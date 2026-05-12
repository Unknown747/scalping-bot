import { logger } from "../lib/logger.js";
import type { ScalpingConfigData } from "./config.js";
import { BASE_CONTRACTS, calculateDynamicSlippage } from "./config.js";
import { getReadProvider, getWriteProvider, withRpcRetry, waitForReceipt } from "./RpcProvider.js";

export interface SwapResult {
  success: boolean;
  txHash: string | null;
  amountIn: bigint;
  amountOut: bigint;
  gasUsed: bigint;
  error?: string;
  usedWeth?: boolean;
  mevProtected?: boolean;
  sandwichDetected?: boolean;
  actualSlippagePct?: number;
  expectedOut?: bigint;
  executionDex?: string;
}

export interface TWAPResult {
  successfulSlices: number;
  totalSlices: number;
  results: SwapResult[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Uniswap V3 QuoterV2 on Base — verified address
const QUOTER_V2 = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";
const FEE_TIERS = [10000, 3000, 500, 100]; // 1%, 0.3%, 0.05%, 0.01%

const feeTierCache = new Map<string, { fee: number; timestamp: number }>();
const FEE_CACHE_TTL = 5 * 60 * 1000; // 5 min

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

/**
 * Calculate safe gas settings for Base network.
 *
 * Base is very cheap (typically 0.001–0.01 gwei base fee).
 * Rules:
 *   - Never set maxFeePerGas below MIN_BASE_FEE_GWEI (avoid stuck txns)
 *   - Use baseFee × 3 headroom so EIP-1559 doesn't reject during fee spikes
 *   - priorityFee from config (default 0.1 gwei — enough to get mined quickly)
 */
function buildGasParams(ethers: any, feeData: any, priorityFeeGwei: number) {
  const MIN_BASE_FEE_GWEI = 0.001; // 1 mwei — absolute floor for Base
  const HEADROOM_MULTIPLIER = 3n;

  const rawBase =
    (feeData as any).lastBaseFeePerGas ??
    feeData.gasPrice ??
    ethers.parseUnits(MIN_BASE_FEE_GWEI.toString(), "gwei");

  // Ensure minimum so tx doesn't hang
  const minBase = ethers.parseUnits(MIN_BASE_FEE_GWEI.toString(), "gwei");
  const baseFee = rawBase < minBase ? minBase : rawBase;

  const priorityFee = ethers.parseUnits(priorityFeeGwei.toString(), "gwei");
  const maxFee = baseFee * HEADROOM_MULTIPLIER + priorityFee;

  return { maxFeePerGas: maxFee, maxPriorityFeePerGas: priorityFee };
}

export class SwapExecutor {
  private config: ScalpingConfigData;
  private walletAddress: string | null;
  private privateKey: string | null;
  private isPaperMode: boolean;

  constructor(config: ScalpingConfigData) {
    this.config = config;
    this.isPaperMode = config.mode === "paper";
    this.privateKey = process.env["PRIVATE_KEY"] || null;
    this.walletAddress = process.env["WALLET_ADDRESS"] || null;
  }

  updateConfig(config: ScalpingConfigData): void {
    this.config = config;
    this.isPaperMode = config.mode === "paper";
  }

  getWalletAddress(): string | null {
    return this.walletAddress;
  }

  // ─── READ OPERATIONS (use readProvider = BASE_RPC_URL) ────────────────────

  async getWalletBalance(): Promise<{ ethBalance: number; wethBalance: number; address: string | null }> {
    if (this.isPaperMode || !this.walletAddress) {
      return { ethBalance: this.config.totalCapitalEth, wethBalance: 0, address: this.walletAddress };
    }
    try {
      return await withRpcRetry(async (provider, ethers) => {
        const [ethBal, wethBal] = await Promise.all([
          provider.getBalance(this.walletAddress!),
          new ethers.Contract(BASE_CONTRACTS.WETH, ERC20_ABI, provider).balanceOf(this.walletAddress!),
        ]);
        return {
          ethBalance: parseFloat(ethers.formatEther(ethBal)),
          wethBalance: parseFloat(ethers.formatEther(wethBal)),
          address: this.walletAddress,
        };
      });
    } catch (err) {
      logger.warn({ err }, "Failed to fetch wallet balance via read RPC");
      return { ethBalance: 0, wethBalance: 0, address: this.walletAddress };
    }
  }

  /** Read WETH balance — always via readProvider */
  private async getWethBalance(ethers: any, readProvider: any): Promise<bigint> {
    if (!this.walletAddress) return 0n;
    try {
      const weth = new ethers.Contract(BASE_CONTRACTS.WETH, ERC20_ABI, readProvider);
      return await weth.balanceOf(this.walletAddress);
    } catch {
      return 0n;
    }
  }

  /** Read token balance — always via readProvider */
  private async getTokenBalance(ethers: any, readProvider: any, tokenAddress: string): Promise<bigint> {
    if (!this.walletAddress) return 0n;
    try {
      const token = new ethers.Contract(tokenAddress, ERC20_ABI, readProvider);
      return await token.balanceOf(this.walletAddress);
    } catch {
      return 0n;
    }
  }

  /** Read allowance — always via readProvider */
  private async getAllowance(
    ethers: any,
    readProvider: any,
    tokenAddress: string,
    spender: string
  ): Promise<bigint> {
    if (!this.walletAddress) return 0n;
    try {
      const token = new ethers.Contract(tokenAddress, ERC20_ABI, readProvider);
      return await token.allowance(this.walletAddress, spender);
    } catch {
      return 0n;
    }
  }

  /**
   * Find best Uniswap V3 fee tier via quoteExactInputSingle.
   * Uses readProvider (BASE_RPC_URL) — pure static call, no gas needed.
   * Returns { fee, expectedOut } — if expectedOut === 0n, no Uniswap V3 pool exists.
   * Caches both hits AND misses (fee=0 = no pool) to avoid repeated RPC calls.
   */
  private async getBestFeeTier(
    ethers: any,
    readProvider: any,
    tokenAddress: string,
    amountInWei: bigint
  ): Promise<{ fee: number; expectedOut: bigint }> {
    const cacheKey = tokenAddress.toLowerCase();
    const cached = feeTierCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < FEE_CACHE_TTL) {
      if (cached.fee === 0) {
        // Cached "no V3 pool" — skip re-query
        return { fee: 0, expectedOut: 0n };
      }
      logger.debug({ tokenAddress, fee: cached.fee }, "Fee tier from cache (read)");
      const expectedOut = await this.getQuote(ethers, readProvider, tokenAddress, amountInWei, cached.fee);
      return { fee: cached.fee, expectedOut };
    }

    const quoterAbi = [
      "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
    ];
    const quoter = new ethers.Contract(QUOTER_V2, quoterAbi, readProvider);

    let bestFee = 0;
    let bestAmountOut = 0n;

    for (const fee of FEE_TIERS) {
      try {
        const [amountOut] = await quoter.quoteExactInputSingle.staticCall({
          tokenIn: BASE_CONTRACTS.WETH,
          tokenOut: tokenAddress,
          amountIn: amountInWei,
          fee,
          sqrtPriceLimitX96: 0,
        });
        if (amountOut > bestAmountOut) {
          bestAmountOut = amountOut;
          bestFee = fee;
        }
      } catch {
        // No pool for this fee tier
      }
    }

    // Cache both hits and misses — fee=0 means "no V3 pool"
    feeTierCache.set(cacheKey, { fee: bestFee, timestamp: Date.now() });

    logger.info(
      { tokenAddress, bestFee, bestAmountOut: bestAmountOut.toString() },
      bestAmountOut > 0n
        ? "Best fee tier found (read RPC)"
        : "No Uniswap V3 pool found on any fee tier (read RPC)"
    );
    return { fee: bestFee, expectedOut: bestAmountOut };
  }

  /**
   * Get expected output quote.
   * Uses readProvider (BASE_RPC_URL) — static call only.
   */
  private async getQuote(
    ethers: any,
    readProvider: any,
    tokenAddress: string,
    amountInWei: bigint,
    fee: number
  ): Promise<bigint> {
    const quoterAbi = [
      "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
    ];
    const quoter = new ethers.Contract(QUOTER_V2, quoterAbi, readProvider);
    try {
      const [amountOut] = await quoter.quoteExactInputSingle.staticCall({
        tokenIn: BASE_CONTRACTS.WETH,
        tokenOut: tokenAddress,
        amountIn: amountInWei,
        fee,
        sqrtPriceLimitX96: 0,
      });
      return amountOut as bigint;
    } catch (err) {
      logger.warn({ err, tokenAddress, fee }, "Quote failed (read RPC)");
      return 0n;
    }
  }

  // ─── WRITE OPERATIONS (use writeProvider = MEV_PROTECTION_RPC) ───────────

  /**
   * Ensure WETH approval for router.
   * Uses writeProvider — this is a real on-chain transaction.
   */
  private async ensureWethApproval(ethers: any, writeWallet: any): Promise<void> {
    // Check allowance via read RPC first (save write RPC calls)
    const { provider: readProvider } = await getReadProvider();
    const allowance = await this.getAllowance(ethers, readProvider, BASE_CONTRACTS.WETH, BASE_CONTRACTS.UNISWAP_V3_ROUTER);

    if (allowance >= ethers.MaxUint256 / 2n) {
      logger.debug({}, "WETH already approved (read check)");
      return;
    }

    logger.info({}, "Approving WETH for Uniswap V3 router (write RPC)");
    const weth = new ethers.Contract(BASE_CONTRACTS.WETH, ERC20_ABI, writeWallet);
    const tx = await weth.approve(BASE_CONTRACTS.UNISWAP_V3_ROUTER, ethers.MaxUint256);
    await waitForReceipt(tx.hash);
    logger.info({ txHash: tx.hash }, "WETH approval confirmed");
  }

  /**
   * Ensure token approval for router.
   * Uses writeProvider — real transaction.
   */
  private async ensureTokenApproval(
    ethers: any,
    writeWallet: any,
    tokenAddress: string,
    amount: bigint
  ): Promise<void> {
    const { provider: readProvider } = await getReadProvider();
    const allowance = await this.getAllowance(ethers, readProvider, tokenAddress, BASE_CONTRACTS.UNISWAP_V3_ROUTER);

    if (allowance >= amount) {
      logger.debug({ tokenAddress }, "Token already approved (read check)");
      return;
    }

    logger.info({ tokenAddress }, "Approving token for router (write RPC)");
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, writeWallet);
    const tx = await token.approve(BASE_CONTRACTS.UNISWAP_V3_ROUTER, ethers.MaxUint256);
    await waitForReceipt(tx.hash);
    logger.info({ txHash: tx.hash, tokenAddress }, "Token approval confirmed");
  }

  // ─── TWAP ─────────────────────────────────────────────────────────────────

  async executeTWAP(
    tokenAddress: string,
    totalAmountEth: number,
    _routerAddress?: string,
    marketData?: { volume5mUsd: number; liquidityUsd: number; priceChange5m: number },
    dexId?: string | null
  ): Promise<TWAPResult> {
    const slices = this.config.twapSlices || 4;
    const intervalMs = this.config.twapIntervalMs || 10000;
    const sliceAmount = totalAmountEth / slices;
    const results: SwapResult[] = [];

    logger.info({ tokenAddress, slices, sliceAmount, intervalMs, dexId }, "TWAP execution started");

    for (let i = 0; i < slices; i++) {
      try {
        const result = await this.buyToken(tokenAddress, sliceAmount, dexId, marketData);
        results.push(result);
        if (result.success) {
          logger.info({ slice: `${i + 1}/${slices}`, amount: sliceAmount }, "TWAP slice OK");
        } else {
          logger.warn({ slice: `${i + 1}/${slices}`, error: result.error }, "TWAP slice failed");
        }
      } catch (err) {
        logger.error({ err, slice: i + 1 }, "TWAP slice error");
        results.push({ success: false, txHash: null, amountIn: 0n, amountOut: 0n, gasUsed: 0n, error: String(err) });
      }
      if (i < slices - 1) await sleep(intervalMs);
    }

    const successfulSlices = results.filter((r) => r.success).length;
    logger.info({ successfulSlices, totalSlices: slices }, "TWAP completed");
    return { successfulSlices, totalSlices: slices, results };
  }

  // ─── BUY TOKEN ────────────────────────────────────────────────────────────

  /**
   * Buy meme token.
   *
   * EXECUTION ROUTER NOTE:
   *   All swaps execute via BASE_CONTRACTS.UNISWAP_V3_ROUTER regardless of which DEX
   *   the price was quoted from. Aerodrome/BaseSwap use a different router ABI and
   *   cannot be called with exactInputSingle — they exist for price comparison only.
   *   If no Uniswap V3 pool exists for this token, the buy is aborted early.
   *
   * READ phase  (BASE_RPC_URL):  fee tier discovery, quote, WETH/ETH balance
   * WRITE phase (MEV_PROTECTION_RPC): approve (if needed) + swap tx
   *
   * WETH path: approve WETH → exactInputSingle(value=0)
   * ETH path:  exactInputSingle(value=amountInWei)  ← router wraps internally
   */
  async buyToken(
    tokenAddress: string,
    amountEth: number,
    dexId?: string | null,
    marketData?: { volume5mUsd: number; liquidityUsd: number; priceChange5m: number }
  ): Promise<SwapResult> {
    if (this.isPaperMode) return this.simulateBuy(tokenAddress, amountEth);
    if (!this.privateKey || !this.walletAddress) {
      return { success: false, txHash: null, amountIn: 0n, amountOut: 0n, gasUsed: 0n, error: "No private key configured" };
    }

    try {
      // ── Phase 1: READ (BASE_RPC_URL) ────────────────────────────────────
      const { provider: readProvider, ethers } = await getReadProvider();

      let slippagePct = this.config.maxSlippagePercent;
      if (this.config.enableDynamicSlippage && marketData) {
        slippagePct = calculateDynamicSlippage(
          marketData.volume5mUsd,
          marketData.liquidityUsd,
          marketData.priceChange5m
        );
      }

      const amountInWei = ethers.parseEther(amountEth.toFixed(18));

      // All reads via BASE_RPC_URL
      const [feeTierResult, wethBalance] = await Promise.all([
        this.getBestFeeTier(ethers, readProvider, tokenAddress, amountInWei),
        this.getWethBalance(ethers, readProvider),
      ]);

      const { fee, expectedOut } = feeTierResult;

      // ── Pre-flight: no Uniswap V3 pool — query ALL V2 DEXes in parallel, pick best ──
      if (expectedOut === 0n) {
        logger.info({ tokenAddress, dexId: dexId ?? "unknown" }, "No Uniswap V3 pool — querying all V2 DEXes in parallel");
        return this.buyTokenBestV2(ethers, tokenAddress, amountEth, slippagePct);
      }

      let amountOutMinimum =
        (expectedOut * BigInt(Math.floor((100 - slippagePct) * 100))) / 10000n;

      const useWeth = wethBalance >= amountInWei;

      logger.info(
        {
          tokenAddress,
          fee,
          amountEth,
          slippagePct,
          useWeth,
          wethBalance: ethers.formatEther(wethBalance),
          expectedOut: expectedOut.toString(),
          amountOutMinimum: amountOutMinimum.toString(),
        },
        useWeth ? "[READ done] Buy will use WETH (ERC-20)" : "[READ done] Buy will use native ETH"
      );

      // ── Phase 2: WRITE (MEV_PROTECTION_RPC) ────────────────────────────
      const { provider: writeProvider, mevActive } = await getWriteProvider();
      const writeWallet = new ethers.Wallet(this.privateKey, writeProvider);

      const feeData = await writeProvider.getFeeData();
      const gasParams = buildGasParams(ethers, feeData, this.config.maxPriorityFeeGwei);

      // Always use Uniswap V3 SwapRouter02 — Aerodrome/BaseSwap use different ABIs
      // SwapRouter02 exactInputSingle does NOT have 'deadline' in struct (removed vs V1)
      const routerAbi = [
        "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)",
      ];
      const router = new ethers.Contract(BASE_CONTRACTS.UNISWAP_V3_ROUTER, routerAbi, writeWallet);

      // ── Pre-flight simulation (read RPC, no gas) ─────────────────────────
      // IMPORTANT: Only run simulation for the native ETH path.
      //
      // WETH path simulation CANNOT be run before approval is set:
      //   - Simulation uses `from: walletAddress` (real on-chain state)
      //   - Router calls WETH.transferFrom(wallet, router, amount)
      //   - If WETH not yet approved → TransferHelper error → would be misclassified as honeypot
      //   - Approval is handled in the WRITE phase via ensureWethApproval()
      //
      // ETH path simulation is safe and useful for detecting actual honeypots:
      //   - Router wraps the sent ETH itself (no transferFrom needed from wallet)
      //   - TransferHelper error here = token's transfer() is broken = real honeypot
      const routerRead = new ethers.Contract(BASE_CONTRACTS.UNISWAP_V3_ROUTER, routerAbi, readProvider);

      if (!useWeth) {
        // Native ETH path only — simulate to catch honeypots before committing gas
        try {
          await routerRead.exactInputSingle.staticCall(
            {
              tokenIn: BASE_CONTRACTS.WETH,
              tokenOut: tokenAddress,
              fee,
              recipient: this.walletAddress,
              amountIn: amountInWei,
              amountOutMinimum,
              sqrtPriceLimitX96: 0,
            },
            { value: amountInWei, from: this.walletAddress }
          );
          logger.debug({ tokenAddress, fee }, "Pre-flight simulation passed (ETH path)");
        } catch (simErr: any) {
          const simMsg: string =
            simErr.shortMessage ||
            simErr.reason ||
            simErr.revert?.args?.[0] ||
            simErr.message ||
            "swap simulation failed";

          const isSlippageRevert =
            simMsg.includes("Too little received") ||
            simMsg.includes("STF") ||
            simMsg.includes("slippage");

          // ONLY block on an explicit TransferHelper error on the ETH path.
          // This means the token's transfer() to the recipient is restricted → clear honeypot/FoT signal.
          //
          // DO NOT block on:
          //   "missing revert data"  — public RPCs often return this when eth_call+value isn't
          //                            properly simulated. This is an RPC infra issue, not a honeypot.
          //   "execution reverted"   — too generic; could be slippage, stale price, or RPC quirk.
          //   "reverted"             — same as above.
          // These should all proceed to the real tx and let the on-chain execution decide.
          const isHoneypot =
            simMsg.includes("TRANSFER_FROM_FAILED") ||
            simMsg.includes("TransferHelper");

          if (isSlippageRevert) {
            // Retry with 2× slippage (up to 20%) — update amountOutMinimum and proceed.
            // Even if the retry simulation also fails, we still continue with the real tx
            // using the wider slippage, rather than aborting. Price can move between
            // quote and simulation; the real tx is the ultimate source of truth.
            const retrySlippagePct = Math.min(slippagePct * 2, 20);
            amountOutMinimum =
              (expectedOut * BigInt(Math.floor((100 - retrySlippagePct) * 100))) / 10000n;

            logger.warn(
              { tokenAddress, fee, simMsg, retrySlippagePct },
              `Slippage simulation fail — retrying with ${retrySlippagePct}% slippage`
            );

            try {
              await routerRead.exactInputSingle.staticCall(
                {
                  tokenIn: BASE_CONTRACTS.WETH,
                  tokenOut: tokenAddress,
                  fee,
                  recipient: this.walletAddress,
                  amountIn: amountInWei,
                  amountOutMinimum,
                  sqrtPriceLimitX96: 0,
                },
                { value: amountInWei, from: this.walletAddress }
              );
              logger.info({ tokenAddress, retrySlippagePct }, "Slippage retry simulation passed — continuing buy");
            } catch (retryErr: any) {
              const retryMsg =
                retryErr.shortMessage ||
                retryErr.reason ||
                retryErr.revert?.args?.[0] ||
                retryErr.message ||
                "retry simulation failed";
              // Still proceed — real tx uses the widened slippage; simulation may be an RPC artefact.
              logger.warn({ tokenAddress, fee, retryMsg }, "Slippage retry simulation also failed — still proceeding with real tx at wider slippage");
            }
          } else if (isHoneypot) {
            // Explicit TransferHelper on ETH path = token blocks transfers = honeypot/FoT.
            logger.warn({ tokenAddress, fee, simMsg }, "Honeypot/FoT detected in ETH-path simulation (TransferHelper) — skipping buy");
            return { success: false, txHash: null, amountIn: 0n, amountOut: 0n, gasUsed: 0n, error: `Honeypot/FoT: ${simMsg}` };
          } else {
            // Anything else (missing revert data, execution reverted, RPC errors, unknown) — proceed.
            // GoPlus already vetted this token; let the real tx be the final arbiter.
            logger.warn({ tokenAddress, fee, simMsg }, "Simulation non-critical error — proceeding with real tx (GoPlus safety already passed)");
          }
        }
      } else {
        // WETH path — skip simulation entirely.
        // ensureWethApproval() in the WRITE phase handles approval before the swap.
        logger.debug({ tokenAddress, fee }, "Skipping pre-flight simulation for WETH path (approval pending)");
      }

      let tx: any;

      if (useWeth) {
        // WETH path — approve via write RPC (real tx), then swap
        await this.ensureWethApproval(ethers, writeWallet);
        tx = await router.exactInputSingle(
          {
            tokenIn: BASE_CONTRACTS.WETH,
            tokenOut: tokenAddress,
            fee,
            recipient: this.walletAddress,
            amountIn: amountInWei,
            amountOutMinimum,
            sqrtPriceLimitX96: 0,
          },
          { value: 0n, ...gasParams }
        );
      } else {
        // Native ETH path — router wraps ETH to WETH internally
        logger.info(
          { wethBalance: ethers.formatEther(wethBalance), needed: amountEth },
          "WETH insufficient, using native ETH"
        );
        tx = await router.exactInputSingle(
          {
            tokenIn: BASE_CONTRACTS.WETH,
            tokenOut: tokenAddress,
            fee,
            recipient: this.walletAddress,
            amountIn: amountInWei,
            amountOutMinimum,
            sqrtPriceLimitX96: 0,
          },
          { value: amountInWei, ...gasParams }
        );
      }

      logger.info(
        { txHash: tx.hash, tokenAddress, useWeth, mevActive },
        mevActive ? "Buy tx submitted via MEV RPC" : "Buy tx submitted via standard RPC"
      );
      const receipt = await waitForReceipt(tx.hash);

      // Parse amountOut from Transfer event (ERC-20 transfer to wallet)
      let amountOut = 0n;
      const transferSig = ethers.id("Transfer(address,address,uint256)");
      for (const log of receipt.logs || []) {
        if (
          log.topics[0] === transferSig &&
          log.topics[2] &&
          ("0x" + log.topics[2].slice(26)).toLowerCase() === this.walletAddress.toLowerCase()
        ) {
          amountOut = BigInt(log.data);
          break;
        }
      }

      // ── MEV Sandwich Detection ──────────────────────────────────────────
      let sandwichDetected = false;
      let actualSlippagePct = 0;
      const SANDWICH_BUFFER_PCT = 2;
      if (expectedOut > 0n && amountOut > 0n) {
        const slippageLost = Number(expectedOut - amountOut) / Number(expectedOut) * 100;
        actualSlippagePct = Math.max(0, slippageLost);
        if (actualSlippagePct > slippagePct + SANDWICH_BUFFER_PCT) {
          sandwichDetected = true;
          logger.warn(
            {
              tokenAddress,
              txHash: receipt.hash,
              expectedOut: expectedOut.toString(),
              actualOut: amountOut.toString(),
              configuredSlippage: slippagePct,
              actualSlippage: actualSlippagePct.toFixed(2),
              mevProtected: mevActive,
            },
            `MEV SANDWICH DETECTED: actual slippage ${actualSlippagePct.toFixed(2)}% >> configured ${slippagePct}%`
          );
        }
      }

      return {
        success: receipt.status === 1,
        txHash: receipt.hash,
        amountIn: amountInWei,
        amountOut,
        gasUsed: receipt.gasUsed,
        usedWeth: useWeth,
        mevProtected: mevActive,
        sandwichDetected,
        actualSlippagePct,
        expectedOut,
        executionDex: "Uniswap V3",
      };
    } catch (err: any) {
      const errMsg = err.shortMessage || err.reason || err.message || "Swap failed";
      logger.error({ err, tokenAddress, amountEth }, "Buy swap failed");
      return {
        success: false,
        txHash: null,
        amountIn: 0n,
        amountOut: 0n,
        gasUsed: 0n,
        error: errMsg,
      };
    }
  }

  // ─── SELL TOKEN ───────────────────────────────────────────────────────────

  /**
   * Sell meme token back to WETH.
   *
   * READ phase  (BASE_RPC_URL):  actual balance check, allowance check
   * WRITE phase (MEV_PROTECTION_RPC): approve (if needed) + swap tx
   */
  async sellToken(tokenAddress: string, amountTokens: bigint, amountEth: number, dexId?: string | null): Promise<SwapResult> {
    if (this.isPaperMode) return this.simulateSell(tokenAddress, amountEth);
    if (!this.privateKey || !this.walletAddress) {
      return { success: false, txHash: null, amountIn: 0n, amountOut: 0n, gasUsed: 0n, error: "No private key configured" };
    }

    try {
      // ── Phase 1: READ (BASE_RPC_URL) ────────────────────────────────────
      const { provider: readProvider, ethers } = await getReadProvider();

      // Route sell to correct DEX based on which DEX executed the buy.
      // dexId here holds the executionDex from the buy result (stored in PositionState).
      if (dexId) {
        const d = dexId.toLowerCase();
        if (d.includes("aerodrome")) {
          logger.info({ tokenAddress, dexId }, "Routing sell → Aerodrome V2 (matched buy DEX)");
          return this.sellTokenAerodrome(ethers, tokenAddress, amountTokens);
        }
        if (d.includes("baseswap")) {
          logger.info({ tokenAddress, dexId }, "Routing sell → BaseSwap V2 (matched buy DEX)");
          return this.sellTokenV2Standard(ethers, tokenAddress, amountTokens, BASE_CONTRACTS.BASESWAP_ROUTER, "BaseSwap V2");
        }
        if (d.includes("pancake")) {
          logger.info({ tokenAddress, dexId }, "Routing sell → PancakeSwap V2 (matched buy DEX)");
          return this.sellTokenV2Standard(ethers, tokenAddress, amountTokens, BASE_CONTRACTS.PANCAKESWAP_V2_ROUTER, "PancakeSwap V2");
        }
        // Uniswap V3 or unknown — fall through to V3 sell below
      } else {
        // No executionDex info — use fee cache to decide
        const sellCached = feeTierCache.get(tokenAddress.toLowerCase());
        const noV3Pool = sellCached && sellCached.fee === 0;
        if (noV3Pool) {
          logger.info({ tokenAddress }, "No V3 pool cached — routing sell → Aerodrome V2 fallback");
          return this.sellTokenAerodrome(ethers, tokenAddress, amountTokens);
        }
      }

      // Always read actual on-chain balance (avoid rounding mismatches)
      const actualBalance = await this.getTokenBalance(ethers, readProvider, tokenAddress);
      if (actualBalance === 0n) {
        logger.warn({ tokenAddress }, "No token balance to sell (read RPC)");
        return { success: false, txHash: null, amountIn: 0n, amountOut: 0n, gasUsed: 0n, error: "Zero balance" };
      }
      const sellAmount = actualBalance < amountTokens ? actualBalance : amountTokens;

      logger.info(
        { tokenAddress, sellAmount: sellAmount.toString(), actualBalance: actualBalance.toString() },
        "Sell amount confirmed (read RPC)"
      );

      // Use cached fee tier from buy (no need to re-query)
      const cacheKey = tokenAddress.toLowerCase();
      const cached = feeTierCache.get(cacheKey);
      const fee = (cached && cached.fee > 0) ? cached.fee : 3000;

      // ── Phase 2: WRITE (MEV_PROTECTION_RPC) ────────────────────────────
      const { provider: writeProvider, mevActive } = await getWriteProvider();
      const writeWallet = new ethers.Wallet(this.privateKey, writeProvider);

      // Approve via write RPC if needed
      await this.ensureTokenApproval(ethers, writeWallet, tokenAddress, sellAmount);

      const feeData = await writeProvider.getFeeData();
      const gasParams = buildGasParams(ethers, feeData, this.config.maxPriorityFeeGwei);

      const routerAbi = [
        "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)",
      ];
      const router = new ethers.Contract(BASE_CONTRACTS.UNISWAP_V3_ROUTER, routerAbi, writeWallet);

      logger.info({ tokenAddress, fee, sellAmount: sellAmount.toString(), mevActive }, "Executing sell → WETH (write RPC)");

      const tx = await router.exactInputSingle(
        {
          tokenIn: tokenAddress,
          tokenOut: BASE_CONTRACTS.WETH,
          fee,
          recipient: this.walletAddress,
          amountIn: sellAmount,
          amountOutMinimum: 0n, // accept any amount — meme coins have unpredictable liquidity
          sqrtPriceLimitX96: 0,
        },
        { ...gasParams }
      );

      logger.info(
        { txHash: tx.hash, tokenAddress, mevActive },
        mevActive ? "Sell tx submitted via MEV RPC" : "Sell tx submitted via standard RPC"
      );
      const receipt = await waitForReceipt(tx.hash);

      // Parse WETH received from Transfer event
      let amountOut = 0n;
      const transferSig = ethers.id("Transfer(address,address,uint256)");
      for (const log of receipt.logs || []) {
        if (
          log.address.toLowerCase() === BASE_CONTRACTS.WETH.toLowerCase() &&
          log.topics[0] === transferSig &&
          log.topics[2] &&
          ("0x" + log.topics[2].slice(26)).toLowerCase() === this.walletAddress.toLowerCase()
        ) {
          amountOut = BigInt(log.data);
          break;
        }
      }

      return {
        success: receipt.status === 1,
        txHash: receipt.hash,
        amountIn: sellAmount,
        amountOut,
        gasUsed: receipt.gasUsed,
        usedWeth: false,
        mevProtected: mevActive,
      };
    } catch (err: any) {
      const errMsg = err.shortMessage || err.reason || err.message || "Sell failed";
      logger.error({ err, tokenAddress, amountEth }, "Sell swap failed");
      return {
        success: false,
        txHash: null,
        amountIn: 0n,
        amountOut: 0n,
        gasUsed: 0n,
        error: errMsg,
      };
    }
  }

  // ─── MULTI-DEX V2 BUY: AERODROME + BASESWAP + PANCAKESWAP (PARALEL) ────────

  /**
   * Query all V2 DEXes in parallel, pick the best quote, then execute on winner.
   * DEXes: Aerodrome V2, BaseSwap V2, PancakeSwap V2.
   * Called when token has no Uniswap V3 pool.
   */
  private async buyTokenBestV2(
    ethers: any,
    tokenAddress: string,
    amountEth: number,
    slippagePct: number
  ): Promise<SwapResult> {
    const amountInWei = ethers.parseEther(amountEth.toFixed(18));
    const { provider: readProvider } = await getReadProvider();

    // ── ABIs ──────────────────────────────────────────────────────────────
    const aeroAbi = [
      "function getAmountsOut(uint256 amountIn, (address from, address to, bool stable, address factory)[] routes) view returns (uint256[] amounts)",
      "function swapExactETHForTokens(uint256 amountOutMin, (address from, address to, bool stable, address factory)[] routes, address to, uint256 deadline) payable returns (uint256[] amounts)",
    ];
    const v2Abi = [
      "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
      "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
    ];

    const aeroRoutes = [{
      from: BASE_CONTRACTS.WETH,
      to: tokenAddress,
      stable: false,
      factory: BASE_CONTRACTS.AERODROME_V2_FACTORY,
    }];
    const v2Path = [BASE_CONTRACTS.WETH, tokenAddress];

    // ── Quote all DEXes in parallel ───────────────────────────────────────
    const aeroContract = new ethers.Contract(BASE_CONTRACTS.AERODROME_V2_ROUTER, aeroAbi, readProvider);
    const bsContract   = new ethers.Contract(BASE_CONTRACTS.BASESWAP_ROUTER, v2Abi, readProvider);
    const psContract   = new ethers.Contract(BASE_CONTRACTS.PANCAKESWAP_V2_ROUTER, v2Abi, readProvider);

    const safeQuote = async (fn: () => Promise<bigint>, name: string): Promise<{ name: string; quote: bigint }> => {
      try {
        const q = await fn();
        logger.info({ tokenAddress, dex: name, quote: q.toString() }, `[Multi-DEX] Quote from ${name}`);
        return { name, quote: q };
      } catch {
        logger.warn({ tokenAddress, dex: name }, `[Multi-DEX] No pool / quote failed on ${name}`);
        return { name, quote: 0n };
      }
    };

    const [aeroResult, bsResult, psResult] = await Promise.all([
      safeQuote(async () => { const a = await aeroContract.getAmountsOut(amountInWei, aeroRoutes); return a[1] ?? 0n; }, "Aerodrome V2"),
      safeQuote(async () => { const a = await bsContract.getAmountsOut(amountInWei, v2Path); return a[1] ?? 0n; }, "BaseSwap V2"),
      safeQuote(async () => { const a = await psContract.getAmountsOut(amountInWei, v2Path); return a[1] ?? 0n; }, "PancakeSwap V2"),
    ]);

    // ── Pick best DEX ─────────────────────────────────────────────────────
    const candidates = [aeroResult, bsResult, psResult].filter(r => r.quote > 0n);
    if (candidates.length === 0) {
      return {
        success: false, txHash: null, amountIn: 0n, amountOut: 0n, gasUsed: 0n,
        error: "No liquidity on any DEX (Uniswap V3, Aerodrome V2, BaseSwap V2, PancakeSwap V2)",
      };
    }

    const best = candidates.reduce((a, b) => (b.quote > a.quote ? b : a));
    logger.info({ tokenAddress, winner: best.name, quote: best.quote.toString() }, "[Multi-DEX] Best V2 quote selected");

    const amountOutMin = (best.quote * BigInt(Math.floor((100 - slippagePct) * 100))) / 10000n;
    const deadline = Math.floor(Date.now() / 1000) + 120;

    const { provider: writeProvider, mevActive } = await getWriteProvider();
    const writeWallet = new ethers.Wallet(this.privateKey!, writeProvider);
    const feeData = await writeProvider.getFeeData();
    const gasParams = buildGasParams(ethers, feeData, this.config.maxPriorityFeeGwei);

    let tx: any;

    if (best.name === "Aerodrome V2") {
      const aeroWrite = new ethers.Contract(BASE_CONTRACTS.AERODROME_V2_ROUTER, aeroAbi, writeWallet);
      logger.info({ tokenAddress, amountEth, amountOutMin: amountOutMin.toString(), mevActive }, "Executing Aerodrome V2 buy");
      tx = await aeroWrite.swapExactETHForTokens(amountOutMin, aeroRoutes, this.walletAddress, deadline, { value: amountInWei, ...gasParams });
    } else {
      const routerAddr = best.name === "BaseSwap V2" ? BASE_CONTRACTS.BASESWAP_ROUTER : BASE_CONTRACTS.PANCAKESWAP_V2_ROUTER;
      const v2Write = new ethers.Contract(routerAddr, v2Abi, writeWallet);
      logger.info({ tokenAddress, amountEth, amountOutMin: amountOutMin.toString(), mevActive, dex: best.name }, `Executing ${best.name} buy`);
      tx = await v2Write.swapExactETHForTokens(amountOutMin, v2Path, this.walletAddress, deadline, { value: amountInWei, ...gasParams });
    }

    logger.info({ txHash: tx.hash, tokenAddress, dex: best.name, mevActive }, `${best.name} buy tx submitted`);
    const receipt = await waitForReceipt(tx.hash);

    // Parse amountOut from Transfer event (ERC-20 transfer to wallet)
    let amountOut = 0n;
    const transferSig = ethers.id("Transfer(address,address,uint256)");
    for (const log of receipt.logs || []) {
      if (
        log.topics[0] === transferSig &&
        log.address.toLowerCase() === tokenAddress.toLowerCase() &&
        log.topics[2] &&
        ("0x" + log.topics[2].slice(26)).toLowerCase() === this.walletAddress!.toLowerCase()
      ) {
        amountOut = BigInt(log.data);
        break;
      }
    }

    const actualSlippagePct = best.quote > 0n && amountOut > 0n
      ? Math.max(0, Number(best.quote - amountOut) / Number(best.quote) * 100)
      : 0;

    return {
      success: receipt.status === 1,
      txHash: receipt.hash,
      amountIn: amountInWei,
      amountOut,
      gasUsed: receipt.gasUsed,
      usedWeth: false,
      mevProtected: mevActive,
      sandwichDetected: false,
      actualSlippagePct,
      expectedOut: best.quote,
      executionDex: best.name,
    };
  }

  // ─── V2 STANDARD SELL (BASESWAP / PANCAKESWAP) ───────────────────────────

  /**
   * Sell token via any standard Uniswap V2–compatible router (token → ETH).
   * Used for BaseSwap V2 and PancakeSwap V2 sells.
   */
  private async sellTokenV2Standard(
    ethers: any,
    tokenAddress: string,
    amountTokens: bigint,
    routerAddr: string,
    dexName: string
  ): Promise<SwapResult> {
    const { provider: readProvider } = await getReadProvider();
    const actualBalance = await this.getTokenBalance(ethers, readProvider, tokenAddress);
    if (actualBalance === 0n) {
      return { success: false, txHash: null, amountIn: 0n, amountOut: 0n, gasUsed: 0n, error: "Zero balance" };
    }
    const sellAmount = actualBalance < amountTokens ? actualBalance : amountTokens;

    const { provider: writeProvider, mevActive } = await getWriteProvider();
    const writeWallet = new ethers.Wallet(this.privateKey!, writeProvider);

    // Approve token for the router
    const { provider: rp } = await getReadProvider();
    const allowance = await this.getAllowance(ethers, rp, tokenAddress, routerAddr);
    if (allowance < sellAmount) {
      logger.info({ tokenAddress, dexName }, `Approving token for ${dexName} router`);
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, writeWallet);
      const approveTx = await tokenContract.approve(routerAddr, ethers.MaxUint256);
      await waitForReceipt(approveTx.hash);
    }

    const feeData = await writeProvider.getFeeData();
    const gasParams = buildGasParams(ethers, feeData, this.config.maxPriorityFeeGwei);

    const v2Abi = [
      "function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)",
    ];
    const router = new ethers.Contract(routerAddr, v2Abi, writeWallet);
    const path = [tokenAddress, BASE_CONTRACTS.WETH];
    const deadline = Math.floor(Date.now() / 1000) + 120;

    logger.info({ tokenAddress, sellAmount: sellAmount.toString(), mevActive, dexName }, `Executing ${dexName} sell → ETH`);

    const tx = await router.swapExactTokensForETH(
      sellAmount,
      0n,
      path,
      this.walletAddress,
      deadline,
      { ...gasParams }
    );

    logger.info({ txHash: tx.hash, tokenAddress, mevActive, dexName }, `${dexName} sell tx submitted`);
    const receipt = await waitForReceipt(tx.hash);

    // Parse ETH received from WETH Withdrawal event
    let amountOut = 0n;
    const withdrawalSig = ethers.id("Withdrawal(address,uint256)");
    for (const log of receipt.logs || []) {
      if (
        log.address.toLowerCase() === BASE_CONTRACTS.WETH.toLowerCase() &&
        log.topics[0] === withdrawalSig
      ) {
        amountOut = BigInt(log.data);
        break;
      }
    }

    return {
      success: receipt.status === 1,
      txHash: receipt.hash,
      amountIn: sellAmount,
      amountOut,
      gasUsed: receipt.gasUsed,
      usedWeth: false,
      mevProtected: mevActive,
    };
  }

  /**
   * Sell token via Aerodrome V2 AMM (token → native ETH).
   */
  private async sellTokenAerodrome(
    ethers: any,
    tokenAddress: string,
    amountTokens: bigint
  ): Promise<SwapResult> {
    const { provider: readProvider } = await getReadProvider();

    const actualBalance = await this.getTokenBalance(ethers, readProvider, tokenAddress);
    if (actualBalance === 0n) {
      logger.warn({ tokenAddress }, "No token balance to sell on Aerodrome (read RPC)");
      return { success: false, txHash: null, amountIn: 0n, amountOut: 0n, gasUsed: 0n, error: "Zero balance" };
    }
    const sellAmount = actualBalance < amountTokens ? actualBalance : amountTokens;

    const { provider: writeProvider, mevActive } = await getWriteProvider();
    const writeWallet = new ethers.Wallet(this.privateKey, writeProvider);

    await this.ensureAerodromeTokenApproval(ethers, writeWallet, tokenAddress, sellAmount);

    const feeData = await writeProvider.getFeeData();
    const gasParams = buildGasParams(ethers, feeData, this.config.maxPriorityFeeGwei);

    const aeroRouterAbi = [
      "function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable, address factory)[] routes, address to, uint256 deadline) returns (uint256[] amounts)",
    ];

    const routes = [{
      from: tokenAddress,
      to: BASE_CONTRACTS.WETH,
      stable: false,
      factory: BASE_CONTRACTS.AERODROME_V2_FACTORY,
    }];
    const deadline = Math.floor(Date.now() / 1000) + 120;

    const aeroRouter = new ethers.Contract(BASE_CONTRACTS.AERODROME_V2_ROUTER, aeroRouterAbi, writeWallet);

    logger.info(
      { tokenAddress, sellAmount: sellAmount.toString(), mevActive },
      "Executing Aerodrome V2 sell → ETH"
    );

    const tx = await aeroRouter.swapExactTokensForETH(
      sellAmount,
      0n,
      routes,
      this.walletAddress,
      deadline,
      { ...gasParams }
    );

    logger.info({ txHash: tx.hash, tokenAddress, mevActive }, mevActive ? "Aerodrome sell via MEV RPC" : "Aerodrome sell via standard RPC");
    const receipt = await waitForReceipt(tx.hash);

    // Aerodrome V2 swapExactTokensForETH: Router calls WETH.withdraw(amount) → sends ETH to `to`.
    // The WETH Withdrawal event is: Withdrawal(address indexed src, uint wad)
    //   topics[0] = keccak256("Withdrawal(address,uint256)")
    //   topics[1] = indexed src = Aerodrome router (who called withdraw)
    //   data      = wad (ETH amount unwrapped)
    let amountOut = 0n;
    const withdrawalSig = ethers.id("Withdrawal(address,uint256)");
    for (const log of receipt.logs || []) {
      if (
        log.address.toLowerCase() === BASE_CONTRACTS.WETH.toLowerCase() &&
        log.topics[0] === withdrawalSig &&
        log.topics[1] &&
        ("0x" + log.topics[1].slice(26)).toLowerCase() === BASE_CONTRACTS.AERODROME_V2_ROUTER.toLowerCase()
      ) {
        amountOut = BigInt(log.data);
        break;
      }
    }

    return {
      success: receipt.status === 1,
      txHash: receipt.hash,
      amountIn: sellAmount,
      amountOut,
      gasUsed: receipt.gasUsed,
      usedWeth: false,
      mevProtected: mevActive,
    };
  }

  /**
   * Ensure ERC-20 token is approved for Aerodrome V2 router (write RPC).
   */
  private async ensureAerodromeTokenApproval(ethers: any, writeWallet: any, tokenAddress: string, amount: bigint): Promise<void> {
    const { provider: readProvider } = await getReadProvider();
    const allowance = await this.getAllowance(ethers, readProvider, tokenAddress, BASE_CONTRACTS.AERODROME_V2_ROUTER);
    if (allowance >= amount) {
      logger.debug({ tokenAddress }, "Aerodrome V2 token already approved");
      return;
    }
    logger.info({ tokenAddress }, "Approving token for Aerodrome V2 router");
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, writeWallet);
    const tx = await token.approve(BASE_CONTRACTS.AERODROME_V2_ROUTER, ethers.MaxUint256);
    await waitForReceipt(tx.hash);
    logger.info({ tokenAddress }, "Aerodrome V2 token approval confirmed");
  }

  // ─── PAPER TRADING SIMULATIONS ────────────────────────────────────────────

  private simulateBuy(tokenAddress: string, amountEth: number): SwapResult {
    const amountInWei = BigInt(Math.floor(amountEth * 1e18));
    // Simulate getting tokens — use a random price for simulation
    const simulatedTokens = BigInt(Math.floor(amountEth * 1e18 * (1 + (Math.random() * 0.02 - 0.01))));
    logger.info({ tokenAddress, amountEth }, "[PAPER] Simulated buy");
    return {
      success: true,
      txHash: null,
      amountIn: amountInWei,
      amountOut: simulatedTokens,
      gasUsed: 0n,
      usedWeth: false,
      mevProtected: false,
      sandwichDetected: false,
      actualSlippagePct: 0,
      expectedOut: simulatedTokens,
    };
  }

  private simulateSell(tokenAddress: string, amountEth: number): SwapResult {
    const amountOutWei = BigInt(Math.floor(amountEth * 1e18 * (1 + (Math.random() * 0.04 - 0.01))));
    logger.info({ tokenAddress, amountEth }, "[PAPER] Simulated sell");
    return {
      success: true,
      txHash: null,
      amountIn: 0n,
      amountOut: amountOutWei,
      gasUsed: 0n,
      usedWeth: false,
      mevProtected: false,
    };
  }
}
