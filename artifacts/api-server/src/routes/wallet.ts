import { Router } from "express";
import { getBot } from "../botInstance.js";
import { PriceMonitor } from "../scalping/PriceMonitor.js";

const router = Router();
const priceMonitor = new PriceMonitor();

router.get("/wallet/balance", async (req, res) => {
  try {
    const bot = getBot();
    const config = bot.getConfig();
    const walletInfo = await bot.getWalletBalance();
    const ethPriceUsd = await priceMonitor.getEthPrice();
    const usdToIdr = 16000;

    res.json({
      address: walletInfo.address,
      ethBalance: walletInfo.ethBalance,
      ethBalanceIdr: walletInfo.ethBalance * ethPriceUsd * usdToIdr,
      ethPriceUsd,
      usdToIdr,
      network: "Base",
    });
  } catch (err) {
    req.log.error({ err }, "Wallet balance error");
    res.status(500).json({ error: "Failed to fetch wallet balance" });
  }
});

export default router;
