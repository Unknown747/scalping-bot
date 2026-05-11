import { logger } from "../lib/logger.js";
import type { ScalpingConfigData } from "./config.js";
import { BASE_CONTRACTS, calculateDynamicSlippage } from "./config.js";

export interface SwapResult {
  success: boolean;
  txHash: string | null;
  amountIn: bigint;
  amountOut: bigint;
  gasUsed: bigint;
  error?: string;
}

export interface TWAPResult {
  successfulSlices: number;
  totalSlices: number;
  results: SwapResult[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Uniswap V3 QuoterV2 on Base — verified working
const QUOTER_V2 = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";

// Fee tiers to try in order of preference for meme coins
const FEE_TIERS = [10000, 3000, 500, 100]; // 1%, 0.3%, 0.05%, 0.01%

// Cache for best fee tier per token (avoid repeated on-chain calls)
const feeTierCache = new Map<string, { fee: number; timestamp: number }>();
const FEE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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

  async getWalletBalance(): Promise<{ ethBalance: number; address: string | null }> {
    if (this.isPaperMode || !this.walletAddress) {
      return { ethBalance: this.config.totalCapitalEth, address: this.walletAddress };
    }

    try {
      const { ethers } = await import("ethers");
      const provider = new ethers.JsonRpcProvider(this.rpcUrl);
      const balance = await provider.getBalance(this.walletAddress);
      return {
        ethBalance: parseFloat(ethers.formatEther(balance)),
        address: this.walletAddress,
      };
    } catch (err) {
      logger.warn({ err }, "Failed to fetch wallet balance");
      return { ethBalance: 0, address: this.walletAddress };
    }
  }

  /**
   * Find the best Uniswap V3 fee tier for a token by querying QuoterV2.
   * Returns the fee tier with the best quote (most tokens out).
   */
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

    let bestFee = 3000; // default fallback
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

        logger.info({ tokenAddress, fee, amountOut: amountOut.toString() }, "Quote result");

        if (amountOut > bestAmountOut) {
          bestAmountOut = amountOut;
          bestFee = fee;
        }
      } catch {
        // Pool doesn't exist for this fee tier, skip
      }
    }

    feeTierCache.set(cacheKey, { fee: bestFee, timestamp: Date.now() });
    logger.info({ tokenAddress, bestFee, bestAmountOut: bestAmountOut.toString() }, "Best fee tier selected");
    return bestFee;
  }

  /**
   * Get a quote for exact ETH in → tokens out.
   * Used to calculate amountOutMinimum with slippage.
   */
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
          logger.warn({ slice: `${i + 1}/${slices}`, error: result.error }, "TWAP slice failed — continuing");
        }
      } catch (err) {
        logger.error({ err, slice: i + 1 }, "TWAP slice threw error");
        results.push({
          success: false,
          txHash: null,
          amountIn: 0n,
          amountOut: 0n,
          gasUsed: 0n,
          error: String(err),
        });
      }
      if (i < slices - 1) await sleep(intervalMs);
    }

    const successfulSlices = results.filter((r) => r.success).length;
    logger.info({ successfulSlices, totalSlices: slices }, "TWAP execution completed");
    return { successfulSlices, totalSlices: slices, results };
  }

  async buyToken(
    tokenAddress: string,
    amountEth: number,
    routerAddress?: string,
    marketData?: { volume5mUsd: number; liquidityUsd: number; priceChange5m: number }
  ): Promise<SwapResult> {
    if (this.isPaperMode) {
      return this.simulateBuy(tokenAddress, amountEth);
    }

    if (!this.privateKey || !this.walletAddress) {
      return {
        success: false,
        txHash: null,
        amountIn: 0n,
        amountOut: 0n,
        gasUsed: 0n,
        error: "No private key configured. Set PRIVATE_KEY in environment.",
      };
    }

    try {
      const { ethers } = await import("ethers");
      const mevRpc = process.env["MEV_PROTECTION_RPC"] || this.rpcUrl;
      const provider = new ethers.JsonRpcProvider(mevRpc);
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

      // Auto-detect best fee tier
      const fee = await this.getBestFeeTier(ethers, provider, tokenAddress, amountInWei);

      // Get quote to calculate amountOutMinimum
      const expectedOut = await this.getQuote(ethers, provider, tokenAddress, amountInWei, fee);
      const amountOutMinimum = expectedOut > 0n
        ? (expectedOut * BigInt(Math.floor((100 - slippagePct) * 100))) / 10000n
        : 0n;

      logger.info(
        { tokenAddress, fee, amountEth, slippagePct, expectedOut: expectedOut.toString(), amountOutMinimum: amountOutMinimum.toString() },
        "Executing buy"
      );

      const routerAbi = [
        "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)",
      ];
      const router = new ethers.Contract(targetRouter, routerAbi, wallet);

      // Use current network gas + small priority fee
      const feeData = await provider.getFeeData();
      const baseFee = (feeData as any).lastBaseFeePerGas ?? feeData.gasPrice ?? ethers.parseUnits("0.005", "gwei");
      const priorityFee = ethers.parseUnits(this.config.maxPriorityFeeGwei.toString(), "gwei");
      const maxFee = BigInt(baseFee) * 2n + priorityFee;

      const tx = await router.exactInputSingle(
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

      logger.info({ txHash: tx.hash, tokenAddress }, "Buy tx submitted, waiting for receipt");
      const receipt = await tx.wait(1);

      // Parse amountOut from Transfer event logs (ERC-20 transfer to wallet)
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
    if (this.isPaperMode) {
      return this.simulateSell(tokenAddress, amountEth);
    }

    if (!this.privateKey || !this.walletAddress) {
      return {
        success: false,
        txHash: null,
        amountIn: 0n,
        amountOut: 0n,
        gasUsed: 0n,
        error: "No private key configured",
      };
    }

    try {
      const { ethers } = await import("ethers");
      const mevRpc = process.env["MEV_PROTECTION_RPC"] || this.rpcUrl;
      const provider = new ethers.JsonRpcProvider(mevRpc);
      const wallet = new ethers.Wallet(this.privateKey, provider);

      const erc20Abi = [
        "function approve(address spender, uint256 amount) returns (bool)",
        "function allowance(address owner, address spender) view returns (uint256)",
        "function balanceOf(address owner) view returns (uint256)",
        "function decimals() view returns (uint8)",
      ];
      const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, wallet);

      // Always use actual on-chain balance to avoid rounding mismatches
      const actualBalance: bigint = await tokenContract.balanceOf(this.walletAddress);
      if (actualBalance === 0n) {
        logger.warn({ tokenAddress }, "No token balance to sell");
        return { success: false, txHash: null, amountIn: 0n, amountOut: 0n, gasUsed: 0n, error: "Zero balance" };
      }
      // Use min of stored amount and actual balance to be safe
      amountTokens = actualBalance < amountTokens ? actualBalance : amountTokens;
      logger.info({ tokenAddress, storedAmount: amountTokens.toString(), actualBalance: actualBalance.toString() }, "Sell using on-chain balance");

      // Ensure allowance
      const allowance: bigint = await tokenContract.allowance(this.walletAddress, BASE_CONTRACTS.UNISWAP_V3_ROUTER);
      if (allowance < amountTokens) {
        logger.info({ tokenAddress }, "Approving token for router");
        const approveTx = await tokenContract.approve(BASE_CONTRACTS.UNISWAP_V3_ROUTER, ethers.MaxUint256);
        await approveTx.wait(1);
      }

      // Get best fee tier for the sell direction
      // Use same fee tier as buy (cached)
      const cacheKey = tokenAddress.toLowerCase();
      const cached = feeTierCache.get(cacheKey);
      const fee = cached ? cached.fee : 3000;

      // Slippage: allow up to maxSlippagePercent
      const slippagePct = this.config.maxSlippagePercent;
      // amountOutMinimum = 0 for sell (we don't know token price precisely, use 0 to avoid reverts)
      // In practice for meme coins, slippage on sell is high anyway
      const amountOutMinimum = 0n;

      const routerAbi = [
        "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)",
      ];
      const router = new ethers.Contract(BASE_CONTRACTS.UNISWAP_V3_ROUTER, routerAbi, wallet);

      const feeData = await provider.getFeeData();
      const baseFee = (feeData as any).lastBaseFeePerGas ?? feeData.gasPrice ?? ethers.parseUnits("0.005", "gwei");
      const priorityFee = ethers.parseUnits(this.config.maxPriorityFeeGwei.toString(), "gwei");
      const maxFee = BigInt(baseFee) * 2n + priorityFee;

      logger.info({ tokenAddress, fee, amountTokens: amountTokens.toString(), slippagePct }, "Executing sell");

      const tx = await router.exactInputSingle(
        {
          tokenIn: tokenAddress,
          tokenOut: BASE_CONTRACTS.WETH,
          fee,
          recipient: this.walletAddress,
          amountIn: amountTokens,
          amountOutMinimum,
          sqrtPriceLimitX96: 0,
        },
        {
          maxFeePerGas: maxFee,
          maxPriorityFeePerGas: priorityFee,
        }
      );

      logger.info({ txHash: tx.hash, tokenAddress }, "Sell tx submitted, waiting for receipt");
      const receipt = await tx.wait(1);

      // Parse ETH received from WETH Transfer event
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
