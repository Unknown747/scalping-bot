import { logger } from "../lib/logger.js";
import { BASE_CONTRACTS } from "./config.js";

export interface DEXQuote {
  dex: string;
  routerAddress: string;
  amountOut: bigint;
  estimatedOutput: number;
}

export interface BestRoute {
  dex: string;
  routerAddress: string;
  amountOut: bigint;
}

// Base network DEX router addresses
export const DEX_ROUTERS = {
  UNISWAP_V3: {
    name: "Uniswap V3",
    router: BASE_CONTRACTS.UNISWAP_V3_ROUTER,
    quoter: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e", // QuoterV2 verified on Base
    type: "v3" as const,
  },
  AERODROME: {
    name: "Aerodrome",
    router: "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43",
    quoter: "0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0",
    type: "v2" as const,
  },
  BASESWAP: {
    name: "BaseSwap",
    router: "0x327Df1E6de05895d2ab08513aaDD9313Fe505d86",
    quoter: "0x4fDBD73aD4B1DDde594BF05AA16028360987D914",
    type: "v2" as const,
  },
} as const;

const QUOTER_V3_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)",
];

const QUOTER_V2_ABI = [
  "function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)",
];

export class DEXAggregator {
  private rpcUrl: string;
  private enabled: boolean;

  constructor(enabled = false) {
    this.rpcUrl = process.env["BASE_RPC_URL"] || "https://mainnet.base.org";
    this.enabled = enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  async getBestRoute(
    tokenAddress: string,
    amountInEth: number
  ): Promise<BestRoute> {
    const defaultRoute: BestRoute = {
      dex: DEX_ROUTERS.UNISWAP_V3.name,
      routerAddress: DEX_ROUTERS.UNISWAP_V3.router,
      amountOut: 0n,
    };

    if (!this.enabled) {
      return defaultRoute;
    }

    try {
      const { ethers } = await import("ethers");
      const provider = new ethers.JsonRpcProvider(this.rpcUrl);
      const amountInWei = ethers.parseEther(amountInEth.toString());

      const quotes = await Promise.allSettled([
        this.quoteUniswapV3(provider, tokenAddress, amountInWei, ethers),
        this.quoteV2DEX(
          provider,
          DEX_ROUTERS.AERODROME.quoter,
          DEX_ROUTERS.AERODROME.name,
          DEX_ROUTERS.AERODROME.router,
          tokenAddress,
          amountInWei,
          ethers
        ),
        this.quoteV2DEX(
          provider,
          DEX_ROUTERS.BASESWAP.quoter,
          DEX_ROUTERS.BASESWAP.name,
          DEX_ROUTERS.BASESWAP.router,
          tokenAddress,
          amountInWei,
          ethers
        ),
      ]);

      const validQuotes: DEXQuote[] = [];
      for (const result of quotes) {
        if (result.status === "fulfilled" && result.value) {
          validQuotes.push(result.value);
        }
      }

      if (validQuotes.length === 0) {
        return defaultRoute;
      }

      // Pick the DEX with highest output (best price)
      const best = validQuotes.reduce((prev, curr) =>
        curr.amountOut > prev.amountOut ? curr : prev
      );

      logger.info(
        {
          token: tokenAddress,
          bestDex: best.dex,
          quotes: validQuotes.map((q) => ({
            dex: q.dex,
            output: q.estimatedOutput,
          })),
        },
        "DEX aggregator selected best route"
      );

      return {
        dex: best.dex,
        routerAddress: best.routerAddress,
        amountOut: best.amountOut,
      };
    } catch (err) {
      logger.warn({ err }, "DEX aggregation failed, using Uniswap V3");
      return defaultRoute;
    }
  }

  private async quoteUniswapV3(
    provider: any,
    tokenAddress: string,
    amountInWei: bigint,
    ethers: any
  ): Promise<DEXQuote> {
    const quoter = new ethers.Contract(
      DEX_ROUTERS.UNISWAP_V3.quoter,
      QUOTER_V3_ABI,
      provider
    );

    try {
      const amountOut = await quoter.quoteExactInputSingle.staticCall(
        BASE_CONTRACTS.WETH,
        tokenAddress,
        3000,
        amountInWei,
        0
      );

      return {
        dex: DEX_ROUTERS.UNISWAP_V3.name,
        routerAddress: DEX_ROUTERS.UNISWAP_V3.router,
        amountOut: BigInt(amountOut.toString()),
        estimatedOutput: parseFloat(ethers.formatUnits(amountOut, 18)),
      };
    } catch {
      // Try 1% pool fee
      const amountOut = await quoter.quoteExactInputSingle.staticCall(
        BASE_CONTRACTS.WETH,
        tokenAddress,
        10000,
        amountInWei,
        0
      );
      return {
        dex: DEX_ROUTERS.UNISWAP_V3.name,
        routerAddress: DEX_ROUTERS.UNISWAP_V3.router,
        amountOut: BigInt(amountOut.toString()),
        estimatedOutput: parseFloat(ethers.formatUnits(amountOut, 18)),
      };
    }
  }

  private async quoteV2DEX(
    provider: any,
    quoterAddress: string,
    dexName: string,
    routerAddress: string,
    tokenAddress: string,
    amountInWei: bigint,
    ethers: any
  ): Promise<DEXQuote> {
    const quoter = new ethers.Contract(quoterAddress, QUOTER_V2_ABI, provider);
    const amounts = await quoter.getAmountsOut(amountInWei, [
      BASE_CONTRACTS.WETH,
      tokenAddress,
    ]);

    const amountOut = BigInt(amounts[1].toString());
    return {
      dex: dexName,
      routerAddress,
      amountOut,
      estimatedOutput: parseFloat(ethers.formatUnits(amountOut, 18)),
    };
  }
}
