import { Router, type IRouter } from "express";
import botRouter from "./bot.js";
import positionsRouter from "./positions.js";
import tradesRouter from "./trades.js";
import statsRouter from "./stats.js";
import configRouter from "./config.js";
import walletRouter from "./wallet.js";
import tokensRouter from "./tokens.js";
import logsRouter from "./logs.js";
import healthRouter from "./health.js";
import secretsRouter from "./secrets.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(botRouter);
router.use(positionsRouter);
router.use(tradesRouter);
router.use(statsRouter);
router.use(configRouter);
router.use(walletRouter);
router.use(tokensRouter);
router.use(logsRouter);
router.use(secretsRouter);

export default router;
