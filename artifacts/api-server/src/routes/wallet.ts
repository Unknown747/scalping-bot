import { Router } from "express";
import { getBot } from "../botInstance.js";
import { PriceMonitor } from "../scalping/PriceMonitor.js";
import { getRpcHealthReport } from "../scalping/RpcProvider.js";

const router = Router();
const priceMonitor = new PriceMonitor();

router.get("/wallet/balance", async (req, res) => {
  try {
    const bot = getBot();
    const walletInfo = await bot.getWalletBalance();
    const ethPriceUsd = await priceMonitor.getEthPrice();
    const usdToIdr = 16000;

    const ethBal = (walletInfo as any).ethBalance ?? 0;
    const wethBal = (walletInfo as any).wethBalance ?? 0;
    const totalEth = ethBal + wethBal;

    res.json({
      address: walletInfo.address,
      ethBalance: ethBal,
      wethBalance: wethBal,
      totalBalanceEth: totalEth,
      ethBalanceIdr: totalEth * ethPriceUsd * usdToIdr,
      ethBalanceUsd: totalEth * ethPriceUsd,
      ethPriceUsd,
      usdToIdr,
      network: "Base",
      preferWeth: wethBal > 0.0001,
    });
  } catch (err) {
    req.log.error({ err }, "Wallet balance error");
    res.status(500).json({ error: "Failed to fetch wallet balance" });
  }
});

router.get("/wallet/rpc-health", (_req, res) => {
  try {
    const report = getRpcHealthReport();
    const mevEndpoint = report.find((r) => r.role === "write-mev");
    const readEndpoint = report.find((r) => r.role === "write-fallback");

    res.json({
      rpcs: report,
      total: report.length,
      healthy: report.filter((r) => r.healthy).length,
      mevActive: mevEndpoint?.healthy ?? false,
      readRpc: readEndpoint?.rpc ?? "mainnet.base.org",
      writeRpc: mevEndpoint?.rpc ?? "not configured",
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to get RPC health" });
  }
});

export default router;
