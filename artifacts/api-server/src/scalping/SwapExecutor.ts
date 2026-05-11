import { logger } from "../lib/logger.js";
import type { ScalpingConfigData } from "./config.js";
import { BASE_CONTRACTS, calculateDynamicSlippage } from "./config.js";
import { getMevProvider, withRpcRetry } from "./RpcProvider.js";

export interface SwapResult {
  success: boolean;
  txHash: string | null;
  amountIn: bigint;
  amountOut: bigint;
  gasUsed: bigint;
  error?: string;
  usedWeth?: boolean;
}

export interface TWAPResult {
  successfulSlices: number;
  totalSlices: number;
  results: SwapResult[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const QUOTER_V2 = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";
const FEE_TIERS = [10000, 3000, 500, 100];

const feeTierCache = new Map<string, { fee: number; timestamp: number }>();
const FEE_CACHE_TTL = 5 * 60 * 1000;

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

export class SwapExecutor {
  private config: ScalpingConfigData;
  private walletAddress: string | null = null;
  private privateKey: string | null = null;
  private rpcUrl: string;
  private isPaperMode: boolean;

  constructor(config: ScalpingConfigData) {
    this.config = config;
    this.isPaperMode = config.mode === "paper";
    this.rpcUrl = process.env["BASE_RPC_URL"] || "https://mainnet.base.org";
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

  async getWalletBalance(): Promise<{ ethBalance: number; wethBalance: number; address: string | null }> {
    if (this.isPaperMode || !this.walletAddress) {
      return { ethBalance: this.config.totalCapitalEth, wethBalance: 0, address: this.walletAddress };
    }

    try {
      return await withRpcRetry(async (provider, ethers) => {
        const [ethBal, wethBal] = await Promise.all([
          provider.getBalance(this.walletAddress!),
          new ethers.Contract(BASE_CONTRACTS.WETH, ERC20_ABI, provider)
            .balanceOf(this.walletAddress!),
        ]);
        return {
          ethBalance: parseFloat(ethers.formatEther(ethBal)),
          wethBalance: parseFloat(ethers.formatEther(wethBal)),
          address: this.walletAddress,
        };
      });
    } catch (err) {
      logger.warn({ err }, "Failed to fetch wallet balance");
      return { ethBalance: 0, wethBalance: 0, address: this.walletAddress };
    }
  }

  /**
   * Get WETH balance for the wallet.
   */
  async getWethBalance(ethers: any, provider: any): Promise<bigint> {
    if (!this.walletAddress) return 0n;
    try {
      const weth = new ethers.Contract(BASE_CONTRACTS.WETH, ERC20_ABI, provider);
      return await weth.balanceOf(this.walletAddress);
    } catch {
      return 0n;
    }
  }

  /**
   * Ensure WETH approval for the router if needed.
   */
  private async ensureWethApproval(ethers: any, wallet: any, amount: bigint): Promise<void> {
    const weth = new ethers.Contract(BASE_CONTRACTS.WETH, ERC20_ABI, wallet);
    const allowance: bigint = await weth.allowance(this.walletAddress, BASE_CONTRACTS.UNISWAP_V3_ROUTER);
    if (allowance < amount) {
      logger.info({}, "Approving WETH for Uniswap V3 router");
      const tx = await weth.approve(BASE_CONTRACTS.UNISWAP_V3_ROUTER, ethers.MaxUint256);
      await tx.wait(1);
      logger.info({}, "WETH approval confirmed");
    }
  }

  private async getBestFeeTier(
    ethers: any,
    provider: any,
    tokenAddress: string,
    amountInWei: bigint
  ): Promise<number> {
    const cacheKey = tokenAddress.toLowerCase();
    const cached = feeTierCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < FEE_CACHE_TTL) {
      logger.info({ tokenAddress, fee: cached.fee }, "Using cached fee tier");
      return cached.fee;
    }

    const quoterAbi = [
      "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
    ];
    const quoter = new ethers.Contract(QUOTER_V2, quoterAbi, provider);

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
        // Pool doesn't exist for this fee tier
      }
    }

    feeTierCache.set(cacheKey, { fee: bestFee, timestamp: Date.now() });
    logger.info({ tokenAddress, bestFee, bestAmountOut: bestAmountOut.toString() }, "Best fee tier selected");
    return bestFee;
  }

  private async getQuote(
    ethers: any,
    provider: any,
    tokenAddress: string,
    amountInWei: bigint,
    fee: number
  ): Promise<bigint> {
    const quoterAbi = [
      "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
    ];
    const quoter = new ethers.Contract(QUOTER_V2, quoterAbi, provider);
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
      logger.warn({ err, tokenAddress, fee }, "Quote failed, using 0 minimum");
      return 0n;
    }
  }

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
          logger.info({ slice: `${i + 1}/${slices}`, amount: sliceAmount }, "TWAP slice executed");
        } else {
          logger.warn({ slice: `${i + 1}/${slices}`, error: result.error }, "TWAP slice failed");
        }
      } catch (err) {
        logger.error({ err, slice: i + 1 }, "TWAP slice threw error");
        results.push({ success: false, txHash: null, amountIn: 0n, amountOut: 0n, gasUsed: 0n, error: String(err) });
      }
      if (i < slices - 1) await sleep(intervalMs);
    }

    const successfulSlices = results.filter((r) => r.success).length;
    logger.info({ successfulSlices, totalSlices: slices }, "TWAP completed");
    return { successfulSlices, totalSlices: slices, results };
  }

  /**
   * Buy token using WETH (preferred) or native ETH (fallback).
   *
   * WETH path:  approve WETH → exactInputSingle(tokenIn=WETH, value=0)
   * ETH path:   exactInputSingle(tokenIn=WETH, value=amountInWei) — router wraps ETH
   *
   * Strategy: prefer WETH if wallet WETH balance >= amountIn.
   * This avoids needing native ETH gas for trading (only gas costs need ETH).
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
      const { provider, ethers } = await getMevProvider();
      const wallet = new ethers.Wallet(this.privateKey, provider);

      // Dynamic slippage
      let slippagePct = this.config.maxSlippagePercent;
      if (this.config.enableDynamicSlippage && marketData) {
        slippagePct = calculateDynamicSlippage(
          marketData.volume5mUsd,
          marketData.liquidityUsd,
          marketData.priceChange5m
        );
        logger.info({ slippagePct }, "Dynamic slippage calculated");
      }

      const amountInWei = ethers.parseEther(amountEth.toFixed(18));
      const targetRouter = routerAddress || BASE_CONTRACTS.UNISWAP_V3_ROUTER;

      const fee = await this.getBestFeeTier(ethers, provider, tokenAddress, amountInWei);
      const expectedOut = await this.getQuote(ethers, provider, tokenAddress, amountInWei, fee);
      const amountOutMinimum = expectedOut > 0n
        ? (expectedOut * BigInt(Math.floor((100 - slippagePct) * 100))) / 10000n
        : 0n;

      // ── Decide: use WETH ERC-20 or native ETH? ──────────────────────────
      const wethBalance = await this.getWethBalance(ethers, provider);
      const useWeth = wethBalance >= amountInWei;

      logger.info(
        { tokenAddress, fee, amountEth, slippagePct, useWeth,
          wethBalance: ethers.formatEther(wethBalance),
          expectedOut: expectedOut.toString() },
        useWeth ? "Executing BUY with WETH (ERC-20)" : "Executing BUY with native ETH"
      );

      const feeData = await provider.getFeeData();
      const baseFee = (feeData as any).lastBaseFeePerGas ?? feeData.gasPrice ?? ethers.parseUnits("0.005", "gwei");
      const priorityFee = ethers.parseUnits(this.config.maxPriorityFeeGwei.toString(), "gwei");
      const maxFee = BigInt(baseFee) * 2n + priorityFee;

      const routerAbi = [
        "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)",
      ];
      const router = new ethers.Contract(targetRouter, routerAbi, wallet);

      let tx: any;

      if (useWeth) {
        // WETH path: approve first, then swap with no ETH value
        await this.ensureWethApproval(ethers, wallet, amountInWei);
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
          {
            value: 0n, // No native ETH — using WETH ERC-20
            maxFeePerGas: maxFee,
            maxPriorityFeePerGas: priorityFee,
          }
        );
      } else {
        // Native ETH path: router wraps ETH to WETH internally
        logger.info({ wethBalance: ethers.formatEther(wethBalance), needed: amountEth }, "WETH insufficient, using native ETH");
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
          {
            value: amountInWei,
            maxFeePerGas: maxFee,
            maxPriorityFeePerGas: priorityFee,
          }
        );
      }

      logger.info({ txHash: tx.hash, tokenAddress, useWeth }, "Buy tx submitted, waiting for receipt");
      const receipt = await tx.wait(1);

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

  async sellToken(tokenAddress: string, amountTokens: bigint, amountEth: number): Promise<SwapResult> {
    if (this.isPaperMode) return this.simulateSell(tokenAddress, amountEth);

    if (!this.privateKey || !this.walletAddress) {
      return { success: false, txHash: null, amountIn: 0n, amountOut: 0n, gasUsed: 0n, error: "No private key configured" };
    }

    try {
      const { provider, ethers } = await getMevProvider();
      const wallet = new ethers.Wallet(this.privateKey, provider);

      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);

      // Always use actual on-chain balance
      const actualBalance: bigint = await tokenContract.balanceOf(this.walletAddress);
      if (actualBalance === 0n) {
        logger.warn({ tokenAddress }, "No token balance to sell");
        return { success: false, txHash: null, amountIn: 0n, amountOut: 0n, gasUsed: 0n, error: "Zero balance" };
      }
      amountTokens = actualBalance < amountTokens ? actualBalance : amountTokens;
      logger.info({ tokenAddress, amountTokens: amountTokens.toString(), actualBalance: actualBalance.toString() }, "Sell using on-chain balance");

      // Ensure allowance for token → router
      const allowance: bigint = await tokenContract.allowance(this.walletAddress, BASE_CONTRACTS.UNISWAP_V3_ROUTER);
      if (allowance < amountTokens) {
        logger.info({ tokenAddress }, "Approving token for router");
        const approveTx = await tokenContract.approve(BASE_CONTRACTS.UNISWAP_V3_ROUTER, ethers.MaxUint256);
        await approveTx.wait(1);
      }

      const cacheKey = tokenAddress.toLowerCase();
      const cached = feeTierCache.get(cacheKey);
      const fee = cached ? cached.fee : 3000;

      const routerAbi = [
        "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)",
      ];
      const router = new ethers.Contract(BASE_CONTRACTS.UNISWAP_V3_ROUTER, routerAbi, wallet);

      const feeData = await provider.getFeeData();
      const baseFee = (feeData as any).lastBaseFeePerGas ?? feeData.gasPrice ?? ethers.parseUnits("0.005", "gwei");
      const priorityFee = ethers.parseUnits(this.config.maxPriorityFeeGwei.toString(), "gwei");
      const maxFee = BigInt(baseFee) * 2n + priorityFee;

      logger.info({ tokenAddress, fee, amountTokens: amountTokens.toString() }, "Executing sell → WETH");

      const tx = await router.exactInputSingle(
        {
          tokenIn: tokenAddress,
          tokenOut: BASE_CONTRACTS.WETH,
          fee,
          recipient: this.walletAddress,
          amountIn: amountTokens,
          amountOutMinimum: 0n,
          sqrtPriceLimitX96: 0,
        },
        {
          maxFeePerGas: maxFee,
          maxPriorityFeePerGas: priorityFee,
        }
      );

      logger.info({ txHash: tx.hash, tokenAddress }, "Sell tx submitted");
      const receipt = await tx.wait(1);

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
        amountIn: amountTokens,
        amountOut,
        gasUsed: receipt.gasUsed,
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

  private simulateBuy(tokenAddress: string, amountEth: number): SwapResult {
    logger.info({ tokenAddress, amountEth }, "Paper trade: BUY simulated");
    return {
      success: true,
      txHash: `paper_${Date.now()}_buy`,
      amountIn: BigInt(Math.floor(amountEth * 1e18)),
      amountOut: BigInt(Math.floor(Math.random() * 1e18)),
      gasUsed: 150000n,
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
    };
  }
}
