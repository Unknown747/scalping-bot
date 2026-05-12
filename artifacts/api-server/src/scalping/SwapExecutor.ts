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
   */
  private async getBestFeeTier(
    ethers: any,
    readProvider: any,
    tokenAddress: string,
    amountInWei: bigint
  ): Promise<number> {
    const cacheKey = tokenAddress.toLowerCase();
    const cached = feeTierCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < FEE_CACHE_TTL) {
      logger.debug({ tokenAddress, fee: cached.fee }, "Fee tier from cache (read)");
      return cached.fee;
    }

    const quoterAbi = [
      "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
    ];
    const quoter = new ethers.Contract(QUOTER_V2, quoterAbi, readProvider);

    let bestFee = 3000;
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

    feeTierCache.set(cacheKey, { fee: bestFee, timestamp: Date.now() });
    logger.info({ tokenAddress, bestFee, bestAmountOut: bestAmountOut.toString() }, "Best fee tier (read RPC)");
    return bestFee;
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
      logger.warn({ err, tokenAddress, fee }, "Quote failed (read RPC), using 0 minimum");
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
    routerAddress?: string,
    marketData?: { volume5mUsd: number; liquidityUsd: number; priceChange5m: number }
  ): Promise<TWAPResult> {
    const slices = this.config.twapSlices || 4;
    const intervalMs = this.config.twapIntervalMs || 10000;
    const sliceAmount = totalAmountEth / slices;
    const results: SwapResult[] = [];

    logger.info({ tokenAddress, slices, sliceAmount, intervalMs }, "TWAP execution started");

    for (let i = 0; i < slices; i++) {
      try {
        const result = await this.buyToken(tokenAddress, sliceAmount, routerAddress, marketData);
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
   * READ phase  (BASE_RPC_URL):  fee tier discovery, quote, WETH/ETH balance
   * WRITE phase (MEV_PROTECTION_RPC): approve (if needed) + swap tx
   *
   * WETH path: approve WETH → exactInputSingle(value=0)
   * ETH path:  exactInputSingle(value=amountInWei)  ← router wraps internally
   */
  async buyToken(
    tokenAddress: string,
    amountEth: number,
    routerAddress?: string,
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
      const targetRouter = routerAddress || BASE_CONTRACTS.UNISWAP_V3_ROUTER;

      // All reads via BASE_RPC_URL
      const [fee, wethBalance] = await Promise.all([
        this.getBestFeeTier(ethers, readProvider, tokenAddress, amountInWei),
        this.getWethBalance(ethers, readProvider),
      ]);

      const expectedOut = await this.getQuote(ethers, readProvider, tokenAddress, amountInWei, fee);
      const amountOutMinimum =
        expectedOut > 0n
          ? (expectedOut * BigInt(Math.floor((100 - slippagePct) * 100))) / 10000n
          : 0n;

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

      const routerAbi = [
        "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)",
      ];
      const router = new ethers.Contract(targetRouter, routerAbi, writeWallet);

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

      return {
        success: receipt.status === 1,
        txHash: receipt.hash,
        amountIn: amountInWei,
        amountOut,
        gasUsed: receipt.gasUsed,
        usedWeth: useWeth,
        mevProtected: mevActive,
      };
    } catch (err: any) {
      logger.error({ err, tokenAddress, amountEth }, "Buy swap failed");
      return {
        success: false,
        txHash: null,
        amountIn: 0n,
        amountOut: 0n,
        gasUsed: 0n,
        error: err.shortMessage || err.message || "Swap failed",
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
  async sellToken(tokenAddress: string, amountTokens: bigint, amountEth: number): Promise<SwapResult> {
    if (this.isPaperMode) return this.simulateSell(tokenAddress, amountEth);
    if (!this.privateKey || !this.walletAddress) {
      return { success: false, txHash: null, amountIn: 0n, amountOut: 0n, gasUsed: 0n, error: "No private key configured" };
    }

    try {
      // ── Phase 1: READ (BASE_RPC_URL) ────────────────────────────────────
      const { provider: readProvider, ethers } = await getReadProvider();

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
      const fee = cached ? cached.fee : 3000;

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
        mevProtected: mevActive,
      };
    } catch (err: any) {
      logger.error({ err, tokenAddress }, "Sell swap failed");
      return {
        success: false,
        txHash: null,
        amountIn: 0n,
        amountOut: 0n,
        gasUsed: 0n,
        error: err.shortMessage || err.message || "Sell failed",
      };
    }
  }

  // ─── Simulation (paper mode) ──────────────────────────────────────────────

  private simulateBuy(tokenAddress: string, amountEth: number): SwapResult {
    logger.info({ tokenAddress, amountEth }, "Paper trade: BUY simulated");
    return {
      success: true,
      txHash: `paper_${Date.now()}_buy`,
      amountIn: BigInt(Math.floor(amountEth * 1e18)),
      amountOut: BigInt(Math.floor(Math.random() * 1e18)),
      gasUsed: 150000n,
      mevProtected: false,
    };
  }

  private simulateSell(tokenAddress: string, estimatedEth: number): SwapResult {
    logger.info({ tokenAddress, estimatedEth }, "Paper trade: SELL simulated");
    return {
      success: true,
      txHash: `paper_${Date.now()}_sell`,
      amountIn: BigInt(Math.floor(Math.random() * 1e18)),
      amountOut: BigInt(Math.floor(estimatedEth * 1e18)),
      gasUsed: 180000n,
      mevProtected: false,
    };
  }
}
