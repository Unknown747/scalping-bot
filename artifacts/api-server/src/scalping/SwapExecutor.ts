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

  // TWAP Execution: splits a buy into multiple slices over time
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

    logger.info(
      { tokenAddress, slices, sliceAmount, intervalMs },
      "TWAP execution started"
    );

    for (let i = 0; i < slices; i++) {
      try {
        const result = await this.buyToken(tokenAddress, sliceAmount, routerAddress, marketData);
        results.push(result);

        if (result.success) {
          logger.info(
            { slice: `${i + 1}/${slices}`, amount: sliceAmount },
            "TWAP slice executed"
          );
        } else {
          logger.warn(
            { slice: `${i + 1}/${slices}`, error: result.error },
            "TWAP slice failed — continuing"
          );
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

      if (i < slices - 1) {
        await sleep(intervalMs);
      }
    }

    const successfulSlices = results.filter((r) => r.success).length;
    logger.info(
      { successfulSlices, totalSlices: slices },
      "TWAP execution completed"
    );

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

      const targetRouter = routerAddress || BASE_CONTRACTS.UNISWAP_V3_ROUTER;

      const routerAbi = [
        "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)",
      ];
      const router = new ethers.Contract(targetRouter, routerAbi, wallet);

      const amountInWei = ethers.parseEther(amountEth.toString());
      const maxPriorityFee = ethers.parseUnits(this.config.maxPriorityFeeGwei.toString(), "gwei");
      const maxFee = ethers.parseUnits(this.config.maxFeePerGasGwei.toString(), "gwei");

      const tx = await router.exactInputSingle(
        {
          tokenIn: BASE_CONTRACTS.WETH,
          tokenOut: tokenAddress,
          fee: 3000,
          recipient: this.walletAddress,
          amountIn: amountInWei,
          amountOutMinimum: 0n,
          sqrtPriceLimitX96: 0,
        },
        {
          value: amountInWei,
          maxFeePerGas: maxFee,
          maxPriorityFeePerGas: maxPriorityFee,
        }
      );

      const receipt = await tx.wait();

      return {
        success: receipt.status === 1,
        txHash: receipt.hash,
        amountIn: amountInWei,
        amountOut: 0n,
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
        error: err.message || "Swap failed",
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
      ];
      const token = new ethers.Contract(tokenAddress, erc20Abi, wallet);
      const allowance = await token.allowance(this.walletAddress, BASE_CONTRACTS.UNISWAP_V3_ROUTER);

      if (allowance < amountTokens) {
        const approveTx = await token.approve(BASE_CONTRACTS.UNISWAP_V3_ROUTER, ethers.MaxUint256);
        await approveTx.wait();
      }

      const routerAbi = [
        "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)",
      ];
      const router = new ethers.Contract(BASE_CONTRACTS.UNISWAP_V3_ROUTER, routerAbi, wallet);
      const maxPriorityFee = ethers.parseUnits(this.config.maxPriorityFeeGwei.toString(), "gwei");
      const maxFee = ethers.parseUnits(this.config.maxFeePerGasGwei.toString(), "gwei");

      const tx = await router.exactInputSingle(
        {
          tokenIn: tokenAddress,
          tokenOut: BASE_CONTRACTS.WETH,
          fee: 3000,
          recipient: this.walletAddress,
          amountIn: amountTokens,
          amountOutMinimum: 0n,
          sqrtPriceLimitX96: 0,
        },
        {
          maxFeePerGas: maxFee,
          maxPriorityFeePerGas: maxPriorityFee,
        }
      );

      const receipt = await tx.wait();
      return {
        success: receipt.status === 1,
        txHash: receipt.hash,
        amountIn: amountTokens,
        amountOut: 0n,
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
        error: err.message || "Sell failed",
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
