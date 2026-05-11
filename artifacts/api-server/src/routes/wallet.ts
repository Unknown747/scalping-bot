import { Router } from "express";
import { getBot } from "../botInstance.js";
import { PriceMonitor } from "../scalping/PriceMonitor.js";

const router = Router();
const priceMonitor = new PriceMonitor();

router.get("/wallet/balance", async (req, res) => {
  const bot = getBot();
  const status = bot.getStatus();
  const config = bot.getConfig();

  let ethBalance = config.totalCapitalEth;
  let address = status.walletAddress;

  try {
    const walletInfo = await (bot as any).swapExecutor?.getWalletBalance();
    if (walletInfo) {
      ethBalance = walletInfo.ethBalance;
      address = walletInfo.address;
    }
  } catch {
    // Use config value as fallback
  }

  const ethPriceUsd = await priceMonitor.getEthPrice();
  const usdToIdr = 16000;

  res.json({
    address,
    ethBalance,
    ethBalanceIdr: ethBalance * ethPriceUsd * usdToIdr,
    ethPriceUsd,
    usdToIdr,
    network: "Base",
    blockNumber: null,
  });
});

export default router;
