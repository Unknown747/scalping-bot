package swap

import (
        "bytes"
        "context"
        "encoding/hex"
        "encoding/json"
        "fmt"
        "log"
        "math/big"
        "net/http"
        "os"
        "strings"
        "time"

        "github.com/decred/dcrd/dcrec/secp256k1/v4"
        "github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
        "golang.org/x/crypto/sha3"
)

const (
        BaseChainID  = int64(8453)
        WETHAddr     = "0x4200000000000000000000000000000000000006"
        USDCAddr     = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" // USDC on Base
        RouterV3Addr = "0x2626664c2603336E57B271c5C0b26F421741e481" // Uniswap V3 SwapRouter02

        // Aerodrome V2 AMM (volatile pools — most common for new meme tokens)
        AerodromeFactoryAddr = "0x420DD381b31aEf6683db6B902084cB0FFECe40Da"
        AerodromeRouterAddr  = "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43"

        // Aerodrome Slipstream (CL, UniV3-compatible concentrated liquidity)
        AeroSlipstreamFactory = "0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A"
        AeroSlipstreamRouter  = "0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5"

        // BaseSwap (UniV2 fork — another popular Base DEX)
        BaseswapFactoryAddr = "0xfDa619b6d20975be80A10332cD39b9a4b0FAa8bb"
        BaseswapRouterAddr  = "0x327Df1E6de05895d1ab08613C08445cE32fE3A2c"

        // SushiSwap V3 on Base
        SushiV3Factory = "0xc35DADB65012eC5796536bD9864eD8773aBc74C4"
        SushiV3Router  = "0xFB7eF66a7e61224DD6FcD0D7d9C3be5C8B049b9f"

        // PancakeSwap V3 on Base
        PancakeV3Factory = "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865"
        PancakeV3Router  = "0x1b81D678ffb9C0263b24A97847620C99d213eB14"

        // SwapBased (UniV2 fork on Base)
        SwapBasedFactory = "0x04C9f118d21e8B767D2e50C946f0cC9F6C367300"
        SwapBasedRouter  = "0xaaa3b1F1bd7BCc97fD1917c18AabFd5579c604E3"
)

// v3DexPairs lists all V3-compatible (factory, router, name) tuples to try in order.
var v3DexPairs = []struct {
        factory, router, name string
}{
        {"0x33128a8fC17869897dcE68Ed026d694621f6FDfD", RouterV3Addr, "Uniswap V3"},
        {SushiV3Factory, SushiV3Router, "SushiSwap V3"},
        {PancakeV3Factory, PancakeV3Router, "PancakeSwap V3"},
}

var feeTiers = []uint32{10000, 3000, 500, 100}

type SwapResult struct {
        TxHash  string
        GasUsed uint64
}

type Executor struct {
        rpc *rpcClient
}

func NewExecutor(rpcURL string) *Executor {
        return &Executor{
                rpc: &rpcClient{
                        url:        rpcURL,
                        httpClient: &http.Client{Timeout: 30 * time.Second},
                },
        }
}

func (e *Executor) Buy(ctx context.Context, tokenAddr string, wethWei *big.Int) (*SwapResult, error) {
        wallet, err := e.walletAddress()
        if err != nil {
                return nil, err
        }

        short := tokenAddr
        if len(short) > 10 {
                short = tokenAddr[:6] + "…" + tokenAddr[len(tokenAddr)-4:]
        }

        // ── Step 1: Try all V3-compatible DEXes (Uniswap, Sushi, PancakeSwap) ────
        v3Pools := e.detectAllV3Pools(ctx, WETHAddr, tokenAddr)
        if len(v3Pools) > 0 {
                log.Printf("🔎 [%s] V3 pools found: %d candidates across DEXes", short, len(v3Pools))
                var lastErr error
                for _, pool := range v3Pools {
                        if err := e.ensureApproval(ctx, WETHAddr, pool.router, wallet, wethWei); err != nil {
                                log.Printf("⚠️  [%s] %s approval failed: %v", short, pool.name, err)
                                continue
                        }
                        nonce, nonceErr := e.rpc.getNonce(ctx, wallet)
                        if nonceErr != nil {
                                lastErr = nonceErr
                                continue
                        }
                        calldata := exactInputSingleCalldata(WETHAddr, tokenAddr, pool.fee, wallet, wethWei, big.NewInt(0))
                        result, err := e.executeSwapWithNonce(ctx, wallet, pool.router, calldata, nonce)
                        if err == nil {
                                log.Printf("💱 [LIVE] %s BUY %s fee=%d tx=%s…", pool.name, short, pool.fee, result.TxHash[:12])
                                return result, nil
                        }
                        log.Printf("⚠️  [%s] %s BUY fee=%d failed: %v", short, pool.name, pool.fee, err)
                        lastErr = err
                }
                log.Printf("⚠️  [%s] All V3 pools failed: %v — trying Aerodrome", short, lastErr)
        } else {
                log.Printf("🔎 [%s] No V3 pool on Uniswap/Sushi/Pancake — trying Aerodrome V2", short)
        }

        // ── Step 2: Try Aerodrome V2 (dominant DEX for meme tokens on Base) ───────
        return e.buyViaAerodrome(ctx, tokenAddr, wethWei, wallet, short)
}

// buyViaAerodrome tries all available Base DEXes in order:
// 1. Aerodrome V2 volatile pool
// 2. Aerodrome Slipstream (CL, UniV3-compatible)
// 3. BaseSwap (UniV2)
func (e *Executor) buyViaAerodrome(ctx context.Context, tokenAddr string, wethWei *big.Int, wallet, short string) (*SwapResult, error) {
        // ── Aerodrome V2 volatile pool ─────────────────────────────────────────────
        hasPool, detErr := e.detectAerodromePool(ctx, WETHAddr, tokenAddr)
        if detErr != nil {
                // RPC error during pool check — pool may still exist; attempt swap to confirm
                log.Printf("⚠️  [%s] Aerodrome V2 pool detection RPC error: %v — trying swap anyway", short, detErr)
                hasPool = true
        }
        if hasPool {
                log.Printf("🔎 [%s] Aerodrome V2 volatile pool candidate — attempting swap", short)
                if err := e.ensureApproval(ctx, WETHAddr, AerodromeRouterAddr, wallet, wethWei); err == nil {
                        nonce, nonceErr := e.rpc.getNonce(ctx, wallet)
                        if nonceErr == nil {
                                deadline := new(big.Int).SetInt64(time.Now().Add(5 * time.Minute).Unix())
                                calldata := aerodromeSwapExactTokensCalldata(WETHAddr, tokenAddr, wallet, AerodromeFactoryAddr, wethWei, deadline)
                                result, swapErr := e.executeSwapWithNonce(ctx, wallet, AerodromeRouterAddr, calldata, nonce)
                                if swapErr == nil {
                                        log.Printf("💱 [LIVE] Aerodrome V2 BUY %s tx=%s… gas=%d", short, result.TxHash[:12], result.GasUsed)
                                        return result, nil
                                }
                                log.Printf("⚠️  [%s] Aerodrome V2 swap failed: %v — trying Slipstream", short, swapErr)
                        }
                } else {
                        log.Printf("⚠️  [%s] Aerodrome V2 approval failed: %v — trying Slipstream", short, err)
                }
        } else {
                log.Printf("🔎 [%s] No Aerodrome V2 volatile pool — trying Slipstream", short)
        }

        // ── Aerodrome Slipstream (CL, UniV3-compatible) ────────────────────────────
        slipFees, _ := e.detectSlipstreamPool(ctx, WETHAddr, tokenAddr)
        if len(slipFees) > 0 {
                log.Printf("🔎 [%s] Aerodrome Slipstream pool found, tick spacings: %v", short, slipFees)
                if err := e.ensureApproval(ctx, WETHAddr, AeroSlipstreamRouter, wallet, wethWei); err == nil {
                        nonce, nonceErr := e.rpc.getNonce(ctx, wallet)
                        if nonceErr == nil {
                                for _, tickSpacing := range slipFees {
                                        calldata := exactInputSingleCalldata(WETHAddr, tokenAddr, tickSpacing, wallet, wethWei, big.NewInt(0))
                                        result, swapErr := e.executeSwapWithNonce(ctx, wallet, AeroSlipstreamRouter, calldata, nonce)
                                        if swapErr == nil {
                                                log.Printf("💱 [LIVE] Slipstream BUY %s tick=%d tx=%s… gas=%d", short, tickSpacing, result.TxHash[:12], result.GasUsed)
                                                return result, nil
                                        }
                                        log.Printf("⚠️  [%s] Slipstream tick=%d failed: %v", short, tickSpacing, swapErr)
                                        nonce = new(big.Int).Add(nonce, big.NewInt(1))
                                }
                        }
                }
                log.Printf("⚠️  [%s] All Slipstream ticks failed — trying BaseSwap", short)
        } else {
                log.Printf("🔎 [%s] No Slipstream pool — trying BaseSwap", short)
        }

        // ── BaseSwap (UniV2) ───────────────────────────────────────────────────────
        hasBaseswap, _ := e.detectBaseswapPool(ctx, WETHAddr, tokenAddr)
        if hasBaseswap {
                log.Printf("🔎 [%s] BaseSwap pool found — attempting swap", short)
                if err := e.ensureApproval(ctx, WETHAddr, BaseswapRouterAddr, wallet, wethWei); err == nil {
                        nonce, nonceErr := e.rpc.getNonce(ctx, wallet)
                        if nonceErr == nil {
                                deadline := new(big.Int).SetInt64(time.Now().Add(5 * time.Minute).Unix())
                                calldata := baseswapSwapExactTokensCalldata(WETHAddr, tokenAddr, wallet, wethWei, deadline)
                                result, swapErr := e.executeSwapWithNonce(ctx, wallet, BaseswapRouterAddr, calldata, nonce)
                                if swapErr == nil {
                                        log.Printf("💱 [LIVE] BaseSwap BUY %s tx=%s… gas=%d", short, result.TxHash[:12], result.GasUsed)
                                        return result, nil
                                }
                                log.Printf("⚠️  [%s] BaseSwap swap failed: %v", short, swapErr)
                        }
                }
        }

        // ── USDC multihop via Uniswap V3: WETH→USDC→TOKEN ─────────────────────────
        // Many new tokens only have TOKEN/USDC pair, not TOKEN/WETH directly.
        log.Printf("🔎 [%s] Trying USDC multihop: WETH→USDC→TOKEN via V3", short)
        usdcFees, _ := e.detectValidFeeTiers(ctx, USDCAddr, tokenAddr)
        if len(usdcFees) > 0 {
                log.Printf("🔎 [%s] TOKEN/USDC V3 pool found (fees=%v) — routing WETH→USDC→TOKEN", short, usdcFees)
                if err := e.ensureApproval(ctx, WETHAddr, RouterV3Addr, wallet, wethWei); err == nil {
                        nonce, nonceErr := e.rpc.getNonce(ctx, wallet)
                        if nonceErr == nil {
                                for _, usdcFee := range usdcFees {
                                        for _, wethUsdcFee := range []uint32{500, 3000} {
                                                path := v3MultihopPath3(WETHAddr, wethUsdcFee, USDCAddr, usdcFee, tokenAddr)
                                                calldata := exactInputCalldata(path, wallet, wethWei, big.NewInt(0))
                                                result, swapErr := e.executeSwapWithNonce(ctx, wallet, RouterV3Addr, calldata, nonce)
                                                if swapErr == nil {
                                                        log.Printf("💱 [LIVE] V3 USDC-hop BUY %s tx=%s…", short, result.TxHash[:12])
                                                        return result, nil
                                                }
                                                log.Printf("⚠️  [%s] V3 USDC-hop fee=%d/%d failed: %v", short, wethUsdcFee, usdcFee, swapErr)
                                                nonce = new(big.Int).Add(nonce, big.NewInt(1))
                                        }
                                }
                        }
                }
        }

        // ── Aerodrome USDC pair: TOKEN/USDC volatile pool ──────────────────────────
        hasAeroUSDC, _ := e.detectAerodromePool(ctx, USDCAddr, tokenAddr)
        if hasAeroUSDC {
                log.Printf("🔎 [%s] Aerodrome TOKEN/USDC pool found — routing WETH→USDC→TOKEN", short)
                if err := e.ensureApproval(ctx, WETHAddr, AerodromeRouterAddr, wallet, wethWei); err == nil {
                        nonce, nonceErr := e.rpc.getNonce(ctx, wallet)
                        if nonceErr == nil {
                                deadline := new(big.Int).SetInt64(time.Now().Add(5 * time.Minute).Unix())
                                // Step 1: WETH→USDC via V3 (deepest WETH/USDC liquidity)
                                wethToUsdcPath := v3MultihopPath(WETHAddr, 500, USDCAddr)
                                step1 := exactInputCalldata(wethToUsdcPath, wallet, wethWei, big.NewInt(0))
                                r1, err1 := e.executeSwapWithNonce(ctx, wallet, RouterV3Addr, step1, nonce)
                                if err1 == nil {
                                        log.Printf("💱 [LIVE] WETH→USDC step1 tx=%s…", r1.TxHash[:12])
                                        // Get USDC balance received
                                        usdcBal, _ := e.getTokenBalance(ctx, USDCAddr, wallet)
                                        if usdcBal.Sign() > 0 {
                                                if err2 := e.ensureApproval(ctx, USDCAddr, AerodromeRouterAddr, wallet, usdcBal); err2 == nil {
                                                        nonce2, _ := e.rpc.getNonce(ctx, wallet)
                                                        calldata2 := aerodromeSwapExactTokensCalldata(USDCAddr, tokenAddr, wallet, AerodromeFactoryAddr, usdcBal, deadline)
                                                        r2, err2 := e.executeSwapWithNonce(ctx, wallet, AerodromeRouterAddr, calldata2, nonce2)
                                                        if err2 == nil {
                                                                log.Printf("💱 [LIVE] USDC→TOKEN Aerodrome BUY %s tx=%s…", short, r2.TxHash[:12])
                                                                return r2, nil
                                                        }
                                                        log.Printf("⚠️  [%s] USDC→TOKEN Aerodrome failed: %v", short, err2)
                                                }
                                        }
                                } else {
                                        log.Printf("⚠️  [%s] WETH→USDC V3 step failed: %v", short, err1)
                                }
                        }
                }
        }

        log.Printf("❌ [%s] No tradeable pool on any Base DEX (V3/Aerodrome/Slipstream/BaseSwap/USDC-hop)", short)
        return nil, fmt.Errorf("no tradeable pool found on any Base DEX for %s", tokenAddr)
}

func (e *Executor) Sell(ctx context.Context, tokenAddr string) (*SwapResult, error) {
        wallet, err := e.walletAddress()
        if err != nil {
                return nil, err
        }

        short := tokenAddr
        if len(short) > 10 {
                short = tokenAddr[:6] + "…" + tokenAddr[len(tokenAddr)-4:]
        }

        balData := balanceOfCalldata(wallet)
        balResult, err := e.rpc.ethCall(ctx, tokenAddr, balData)
        if err != nil {
                return nil, fmt.Errorf("balance check: %w", err)
        }
        tokenBalance := parseBigInt(balResult)
        if tokenBalance.Sign() == 0 {
                return nil, fmt.Errorf("zero token balance — nothing to sell")
        }
        log.Printf("💼 [%s] Sell balance: %s raw tokens", short, tokenBalance.String())

        // ── Step 1: Try Uniswap V3 ────────────────────────────────────────────────
        validFees, err := e.detectValidFeeTiers(ctx, tokenAddr, WETHAddr)
        if err != nil {
                log.Printf("⚠️  [%s] V3 SELL pool detection error: %v", short, err)
        }

        if len(validFees) > 0 {
                log.Printf("🔎 [%s] Uniswap V3 SELL via fee tiers: %v", short, validFees)
                if err := e.ensureApproval(ctx, tokenAddr, RouterV3Addr, wallet, tokenBalance); err != nil {
                        return nil, fmt.Errorf("token V3 approval: %w", err)
                }
                nonce, err := e.rpc.getNonce(ctx, wallet)
                if err != nil {
                        return nil, fmt.Errorf("get nonce: %w", err)
                }
                var lastErr error
                for _, fee := range validFees {
                        calldata := exactInputSingleCalldata(tokenAddr, WETHAddr, fee, wallet, tokenBalance, big.NewInt(0))
                        result, err := e.executeSwapWithNonce(ctx, wallet, RouterV3Addr, calldata, nonce)
                        if err == nil {
                                log.Printf("💱 [LIVE] V3 SELL %s fee=%d tx=%s…", short, fee, result.TxHash[:12])
                                return result, nil
                        }
                        log.Printf("⚠️  [%s] V3 SELL fee=%d failed: %v", short, fee, err)
                        lastErr = err
                        nonce = new(big.Int).Add(nonce, big.NewInt(1))
                }
                log.Printf("⚠️  [%s] All V3 SELL fee tiers failed: %v — trying Aerodrome", short, lastErr)
        } else {
                log.Printf("🔎 [%s] No Uniswap V3 SELL pool — trying Aerodrome V2", short)
        }

        // ── Step 2: Try Aerodrome V2 ───────────────────────────────────────────────
        return e.sellViaAerodrome(ctx, tokenAddr, tokenBalance, wallet, short)
}

// sellViaAerodrome tries all available Base DEXes for selling: Aerodrome V2, Slipstream, BaseSwap.
func (e *Executor) sellViaAerodrome(ctx context.Context, tokenAddr string, tokenBalance *big.Int, wallet, short string) (*SwapResult, error) {
        // ── Aerodrome V2 volatile pool ─────────────────────────────────────────────
        hasPool, detErr := e.detectAerodromePool(ctx, tokenAddr, WETHAddr)
        if detErr != nil {
                log.Printf("⚠️  [%s] Aerodrome V2 SELL pool detection RPC error: %v — trying anyway", short, detErr)
                hasPool = true
        }
        if hasPool {
                if err := e.ensureApproval(ctx, tokenAddr, AerodromeRouterAddr, wallet, tokenBalance); err == nil {
                        nonce, nonceErr := e.rpc.getNonce(ctx, wallet)
                        if nonceErr == nil {
                                deadline := new(big.Int).SetInt64(time.Now().Add(5 * time.Minute).Unix())
                                calldata := aerodromeSwapExactTokensCalldata(tokenAddr, WETHAddr, wallet, AerodromeFactoryAddr, tokenBalance, deadline)
                                result, swapErr := e.executeSwapWithNonce(ctx, wallet, AerodromeRouterAddr, calldata, nonce)
                                if swapErr == nil {
                                        log.Printf("💱 [LIVE] Aerodrome V2 SELL %s tx=%s… gas=%d", short, result.TxHash[:12], result.GasUsed)
                                        return result, nil
                                }
                                log.Printf("⚠️  [%s] Aerodrome V2 SELL failed: %v — trying Slipstream", short, swapErr)
                        }
                }
        }

        // ── Aerodrome Slipstream ───────────────────────────────────────────────────
        slipFees, _ := e.detectSlipstreamPool(ctx, tokenAddr, WETHAddr)
        if len(slipFees) > 0 {
                if err := e.ensureApproval(ctx, tokenAddr, AeroSlipstreamRouter, wallet, tokenBalance); err == nil {
                        nonce, nonceErr := e.rpc.getNonce(ctx, wallet)
                        if nonceErr == nil {
                                for _, tickSpacing := range slipFees {
                                        calldata := exactInputSingleCalldata(tokenAddr, WETHAddr, tickSpacing, wallet, tokenBalance, big.NewInt(0))
                                        result, swapErr := e.executeSwapWithNonce(ctx, wallet, AeroSlipstreamRouter, calldata, nonce)
                                        if swapErr == nil {
                                                log.Printf("💱 [LIVE] Slipstream SELL %s tick=%d tx=%s…", short, tickSpacing, result.TxHash[:12])
                                                return result, nil
                                        }
                                        nonce = new(big.Int).Add(nonce, big.NewInt(1))
                                }
                        }
                }
        }

        // ── BaseSwap (UniV2) ───────────────────────────────────────────────────────
        hasBaseswap, _ := e.detectBaseswapPool(ctx, tokenAddr, WETHAddr)
        if hasBaseswap {
                if err := e.ensureApproval(ctx, tokenAddr, BaseswapRouterAddr, wallet, tokenBalance); err == nil {
                        nonce, nonceErr := e.rpc.getNonce(ctx, wallet)
                        if nonceErr == nil {
                                deadline := new(big.Int).SetInt64(time.Now().Add(5 * time.Minute).Unix())
                                calldata := baseswapSwapExactTokensCalldata(tokenAddr, WETHAddr, wallet, tokenBalance, deadline)
                                result, swapErr := e.executeSwapWithNonce(ctx, wallet, BaseswapRouterAddr, calldata, nonce)
                                if swapErr == nil {
                                        log.Printf("💱 [LIVE] BaseSwap SELL %s tx=%s… gas=%d", short, result.TxHash[:12], result.GasUsed)
                                        return result, nil
                                }
                                log.Printf("⚠️  [%s] BaseSwap SELL failed: %v", short, swapErr)
                        }
                }
        }

        log.Printf("❌ [%s] No tradeable SELL pool found on any Base DEX", short)
        return nil, fmt.Errorf("no tradeable SELL pool found on any Base DEX for %s", tokenAddr)
}

// queryGasPrice fetches the current Base gas price via eth_gasPrice and returns
// (maxPriorityFee, maxFee) for EIP-1559 transactions.
// Base L2 is typically 0.001–0.05 gwei — we apply a 1.3× buffer and hard-cap
// at 0.5 gwei to prevent L1 price bleed-through from inflating costs.
func (e *Executor) queryGasPrice(ctx context.Context) (priorityFee, maxFee *big.Int) {
        const (
                capGwei     = 500_000_000   // 0.5 gwei hard cap (Base is always below this)
                fallbackFee = 5_000_000     // 0.005 gwei — safe Base fallback
                minPriority = 100_000       // 0.0001 gwei minimum priority
        )

        res, err := e.rpc.call(ctx, "eth_gasPrice")
        if err != nil {
                log.Printf("⚠️  eth_gasPrice error, using fallback: %v", err)
                return big.NewInt(minPriority), big.NewInt(fallbackFee)
        }
        var s string
        json.Unmarshal(res, &s)
        gp := new(big.Int)
        gp.SetString(strings.TrimPrefix(s, "0x"), 16)

        // 1.3× buffer so tx gets mined quickly
        gp.Mul(gp, big.NewInt(13))
        gp.Div(gp, big.NewInt(10))

        // Hard cap — never pay L1 prices on Base
        if gp.Cmp(big.NewInt(capGwei)) > 0 {
                gp = big.NewInt(capGwei)
        }
        if gp.Sign() == 0 {
                gp = big.NewInt(fallbackFee)
        }

        // Priority fee = 10% of maxFee (tiny on Base), minimum 0.0001 gwei
        pFee := new(big.Int).Div(gp, big.NewInt(10))
        if pFee.Cmp(big.NewInt(minPriority)) < 0 {
                pFee = big.NewInt(minPriority)
        }

        log.Printf("⛽  Gas: maxFee=%s wei (%.6f gwei)  priority=%s wei",
                gp.String(), float64(gp.Int64())/1e9, pFee.String())
        return pFee, gp
}

func (e *Executor) executeSwap(ctx context.Context, walletAddr, routerAddr string, calldata []byte) (*SwapResult, error) {
        nonce, err := e.rpc.getNonce(ctx, walletAddr)
        if err != nil {
                return nil, fmt.Errorf("get nonce: %w", err)
        }
        return e.executeSwapWithNonce(ctx, walletAddr, routerAddr, calldata, nonce)
}

// estimateGas calls eth_estimateGas to get the gas needed for a call,
// applies a 1.5× buffer, and caps at 600k. Falls back to 300k on error.
func (e *Executor) estimateGas(ctx context.Context, from, to string, data []byte, value *big.Int) *big.Int {
        params := map[string]interface{}{
                "from": from,
                "to":   to,
                "data": "0x" + hex.EncodeToString(data),
        }
        if value != nil && value.Sign() > 0 {
                params["value"] = "0x" + value.Text(16)
        }
        res, err := e.rpc.call(ctx, "eth_estimateGas", params, "latest")
        if err != nil {
                log.Printf("⚠️  eth_estimateGas failed: %v — using 300k fallback", err)
                return big.NewInt(300_000)
        }
        var s string
        json.Unmarshal(res, &s)
        n := new(big.Int)
        n.SetString(strings.TrimPrefix(s, "0x"), 16)
        if n.Sign() == 0 {
                return big.NewInt(300_000)
        }
        // 1.5× buffer so we don't run out of gas on complex paths
        n.Mul(n, big.NewInt(15))
        n.Div(n, big.NewInt(10))
        cap := big.NewInt(600_000)
        if n.Cmp(cap) > 0 {
                n.Set(cap)
        }
        log.Printf("⛽  Estimated gas: %s (after 1.5× buffer)", n.String())
        return n
}

// simulateCall runs eth_call (no state change) to pre-check if a TX would revert.
// Returns nil if call succeeds, or an error with the revert reason.
func (e *Executor) simulateCall(ctx context.Context, from, to string, data []byte) error {
        params := map[string]interface{}{
                "from": from,
                "to":   to,
                "data": "0x" + hex.EncodeToString(data),
        }
        _, err := e.rpc.call(ctx, "eth_call", params, "latest")
        return err
}

// executeSwapWithNonce signs and sends a swap TX using a caller-supplied nonce.
// This avoids the nonce-too-low problem when retrying across multiple fee tiers
// in a single block: the caller increments the nonce locally between retries.
func (e *Executor) executeSwapWithNonce(ctx context.Context, walletAddr, routerAddr string, calldata []byte, nonce *big.Int) (*SwapResult, error) {
        privKey, err := loadPrivKey()
        if err != nil {
                return nil, err
        }

        // Pre-simulate the call to catch revert reasons before spending gas
        if simErr := e.simulateCall(ctx, walletAddr, routerAddr, calldata); simErr != nil {
                return nil, fmt.Errorf("pre-simulation revert: %v", simErr)
        }

        // Estimate actual gas needed (with 1.5× buffer)
        gasLimit := e.estimateGas(ctx, walletAddr, routerAddr, calldata, big.NewInt(0))

        priorityFee, maxFee := e.queryGasPrice(ctx)
        rawTx, err := buildAndSignTx(
                big.NewInt(BaseChainID), nonce,
                priorityFee,
                maxFee,
                gasLimit,
                routerAddr, big.NewInt(0), calldata, privKey,
        )
        if err != nil {
                return nil, fmt.Errorf("sign tx: %w", err)
        }
        txHash, err := e.rpc.sendRawTx(ctx, rawTx)
        if err != nil {
                return nil, fmt.Errorf("send tx: %w", err)
        }
        receipt, err := e.rpc.waitReceipt(ctx, txHash, 90*time.Second)
        if err != nil {
                return nil, fmt.Errorf("wait receipt: %w", err)
        }
        if receipt.Status == "0x0" {
                return nil, fmt.Errorf("tx reverted on-chain (txHash=%s) — check BaseScan for details", txHash)
        }
        gasUsed := new(big.Int)
        gasUsed.SetString(strings.TrimPrefix(receipt.GasUsed, "0x"), 16)
        return &SwapResult{TxHash: txHash, GasUsed: gasUsed.Uint64()}, nil
}

// v3PoolResult holds a discovered V3 pool's fee tier and which DEX it belongs to.
type v3PoolResult struct {
        fee    uint32
        router string
        name   string
}

// detectAllV3Pools checks Uniswap V3, SushiSwap V3, and PancakeSwap V3 factories
// for tokenA/tokenB pools across all fee tiers. Returns results with router info.
func (e *Executor) detectAllV3Pools(ctx context.Context, tokenA, tokenB string) []v3PoolResult {
        var results []v3PoolResult
        for _, dex := range v3DexPairs {
                for _, fee := range feeTiers {
                        data := getPoolCalldata(tokenA, tokenB, fee)
                        result, err := e.rpc.ethCall(ctx, dex.factory, data)
                        if err != nil {
                                continue
                        }
                        if len(result) >= 20 {
                                addr := result[len(result)-20:]
                                for _, b := range addr {
                                        if b != 0 {
                                                results = append(results, v3PoolResult{fee: fee, router: dex.router, name: dex.name})
                                                break
                                        }
                                }
                        }
                }
        }
        return results
}

// detectValidFeeTiers calls Uniswap V3 Factory.getPool() for each fee tier and
// returns only those where a real pool (non-zero address) exists on Base.
// Checks Uniswap V3, SushiSwap V3, and PancakeSwap V3 factories.
func (e *Executor) detectValidFeeTiers(ctx context.Context, tokenA, tokenB string) ([]uint32, error) {
        var valid []uint32
        seen := map[uint32]bool{}
        for _, p := range e.detectAllV3Pools(ctx, tokenA, tokenB) {
                if !seen[p.fee] {
                        seen[p.fee] = true
                        valid = append(valid, p.fee)
                }
        }
        return valid, nil
}

// getPool(address,address,uint24) selector: 0x1698ee82
func getPoolCalldata(tokenA, tokenB string, fee uint32) []byte {
        d := []byte{0x16, 0x98, 0xee, 0x82}
        d = append(d, abiAddr(tokenA)...)
        d = append(d, abiAddr(tokenB)...)
        d = append(d, abiUint256(big.NewInt(int64(fee)))...)
        return d
}

// detectAerodromePool calls Aerodrome V2 Factory.getPool(tokenA, tokenB, false)
// and returns true if a non-zero pool address exists (volatile pool).
func (e *Executor) detectAerodromePool(ctx context.Context, tokenA, tokenB string) (bool, error) {
        // getPool(address,address,bool) — compute selector from signature
        sel := keccak256([]byte("getPool(address,address,bool)"))[:4]
        d := make([]byte, 0, 4+96)
        d = append(d, sel...)
        d = append(d, abiAddr(tokenA)...)
        d = append(d, abiAddr(tokenB)...)
        d = append(d, abiUint256(big.NewInt(0))...) // stable = false
        result, err := e.rpc.ethCall(ctx, AerodromeFactoryAddr, d)
        if err != nil {
                return false, err
        }
        if len(result) < 20 {
                return false, nil
        }
        addr := result[len(result)-20:]
        for _, b := range addr {
                if b != 0 {
                        return true, nil
                }
        }
        return false, nil
}

// aerodromeSwapExactTokensCalldata encodes:
// swapExactTokensForTokens(uint256,uint256,(address,address,bool,address)[],address,uint256)
// with a single-hop volatile route: tokenIn → tokenOut via AerodromeFactoryAddr.
func aerodromeSwapExactTokensCalldata(tokenIn, tokenOut, recipient, factory string, amountIn, deadline *big.Int) []byte {
        // Selector: keccak256("swapExactTokensForTokens(uint256,uint256,(address,address,bool,address)[],address,uint256)")
        sel := keccak256([]byte("swapExactTokensForTokens(uint256,uint256,(address,address,bool,address)[],address,uint256)"))[:4]

        // ABI encoding (5 params, routes is dynamic at offset 160 = 0xa0):
        // slot 0: amountIn
        // slot 1: amountOutMin = 0
        // slot 2: offset to routes = 5*32 = 160
        // slot 3: recipient
        // slot 4: deadline
        // --- routes data ---
        // slot 5: routes.length = 1
        // slot 6: routes[0].from
        // slot 7: routes[0].to
        // slot 8: routes[0].stable = false (0)
        // slot 9: routes[0].factory
        d := make([]byte, 0, 4+10*32)
        d = append(d, sel...)
        d = append(d, abiUint256(amountIn)...)
        d = append(d, abiUint256(big.NewInt(0))...)      // amountOutMin = 0
        d = append(d, abiUint256(big.NewInt(160))...)    // offset = 5*32 = 160
        d = append(d, abiAddr(recipient)...)
        d = append(d, abiUint256(deadline)...)
        d = append(d, abiUint256(big.NewInt(1))...)      // routes.length = 1
        d = append(d, abiAddr(tokenIn)...)               // routes[0].from
        d = append(d, abiAddr(tokenOut)...)              // routes[0].to
        d = append(d, abiUint256(big.NewInt(0))...)      // routes[0].stable = false
        d = append(d, abiAddr(factory)...)               // routes[0].factory
        return d
}

// detectSlipstreamPool checks Aerodrome Slipstream (CL) factory for pools with common tick spacings.
// Slipstream is UniV3-compatible concentrated liquidity — common for newer tokens on Base.
func (e *Executor) detectSlipstreamPool(ctx context.Context, tokenA, tokenB string) ([]uint32, error) {
        // getPool(address,address,int24) — same signature as Uniswap V3 factory
        var valid []uint32
        for _, fee := range feeTiers { // reuse fee tiers as tick spacings (1, 100, 500, 3000, 10000 mapped → 1, 50, 100, 200)
                data := getPoolCalldata(tokenA, tokenB, fee)
                result, err := e.rpc.ethCall(ctx, AeroSlipstreamFactory, data)
                if err != nil {
                        continue
                }
                if len(result) >= 20 {
                        addr := result[len(result)-20:]
                        for _, b := range addr {
                                if b != 0 {
                                        valid = append(valid, fee)
                                        break
                                }
                        }
                }
        }
        return valid, nil
}

// detectBaseswapPool calls BaseSwap (UniV2) factory.getPair(tokenA, tokenB) and returns true if pool exists.
func (e *Executor) detectBaseswapPool(ctx context.Context, tokenA, tokenB string) (bool, error) {
        // getPair(address,address) selector: keccak256("getPair(address,address)")[:4] = 0xe6a43905
        d := []byte{0xe6, 0xa4, 0x39, 0x05}
        d = append(d, abiAddr(tokenA)...)
        d = append(d, abiAddr(tokenB)...)
        result, err := e.rpc.ethCall(ctx, BaseswapFactoryAddr, d)
        if err != nil {
                return false, err
        }
        if len(result) < 20 {
                return false, nil
        }
        addr := result[len(result)-20:]
        for _, b := range addr {
                if b != 0 {
                        return true, nil
                }
        }
        return false, nil
}

// baseswapSwapExactTokensCalldata encodes UniV2-style swapExactTokensForTokens.
// swapExactTokensForTokens(uint256,uint256,address[],address,uint256)
func baseswapSwapExactTokensCalldata(tokenIn, tokenOut, recipient string, amountIn, deadline *big.Int) []byte {
        // selector: keccak256("swapExactTokensForTokens(uint256,uint256,address[],address,uint256)")[:4] = 0x38ed1739
        d := []byte{0x38, 0xed, 0x17, 0x39}
        d = append(d, abiUint256(amountIn)...)         // amountIn
        d = append(d, abiUint256(big.NewInt(0))...)    // amountOutMin = 0
        d = append(d, abiUint256(big.NewInt(128))...)  // offset to path = 4*32 = 128
        d = append(d, abiAddr(recipient)...)           // to
        d = append(d, abiUint256(deadline)...)         // deadline
        d = append(d, abiUint256(big.NewInt(2))...)    // path.length = 2
        d = append(d, abiAddr(tokenIn)...)             // path[0]
        d = append(d, abiAddr(tokenOut)...)            // path[1]
        return d
}

func (e *Executor) ensureApproval(ctx context.Context, tokenAddr, spender, owner string, amount *big.Int) error {
        alwData := allowanceCalldata(owner, spender)
        alwResult, err := e.rpc.ethCall(ctx, tokenAddr, alwData)
        if err != nil {
                return fmt.Errorf("allowance check: %w", err)
        }
        if parseBigInt(alwResult).Cmp(amount) >= 0 {
                log.Printf("✅ Approval already sufficient for %s…%s", tokenAddr[:6], tokenAddr[len(tokenAddr)-4:])
                return nil
        }
        privKey, err := loadPrivKey()
        if err != nil {
                return err
        }
        nonce, err := e.rpc.getNonce(ctx, owner)
        if err != nil {
                return fmt.Errorf("approval nonce: %w", err)
        }
        maxUint256 := new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1))
        calldata := approveCalldata(spender, maxUint256)
        // Estimate gas for approval (ERC20 approve is typically 45-65k on Base)
        gasLimit := e.estimateGas(ctx, owner, tokenAddr, calldata, nil)
        if gasLimit.Cmp(big.NewInt(30_000)) < 0 {
                gasLimit = big.NewInt(80_000) // safety floor for approve
        }
        priorityFee, maxFee := e.queryGasPrice(ctx)
        rawTx, err := buildAndSignTx(
                big.NewInt(BaseChainID), nonce,
                priorityFee,
                maxFee,
                gasLimit,
                tokenAddr, big.NewInt(0), calldata, privKey,
        )
        if err != nil {
                return err
        }
        txHash, err := e.rpc.sendRawTx(ctx, rawTx)
        if err != nil {
                return err
        }
        log.Printf("⏳ Approval TX sent: %s…", txHash[:12])
        receipt, err := e.rpc.waitReceipt(ctx, txHash, 60*time.Second)
        if err != nil {
                return err
        }
        if receipt.Status == "0x0" {
                return fmt.Errorf("approval tx reverted (txHash=%s)", txHash)
        }
        log.Printf("✅ Approval confirmed: %s…%s tx=%s…", tokenAddr[:6], tokenAddr[len(tokenAddr)-4:], txHash[:12])
        return nil
}

func (e *Executor) walletAddress() (string, error) {
        privKey, err := loadPrivKey()
        if err != nil {
                return "", err
        }
        pub := privKey.PubKey().SerializeUncompressed() // 65 bytes, 0x04 prefix
        addrHash := keccak256(pub[1:])
        return "0x" + hex.EncodeToString(addrHash[12:]), nil
}

// ── Exported query helpers ────────────────────────────────────────────────────

// WalletAddr returns the Ethereum address derived from WALLET_PRIVATE_KEY.
func (e *Executor) WalletAddr() (string, error) {
        return e.walletAddress()
}

// GetNativeETHBalance returns the wallet's native ETH balance in wei.
func (e *Executor) GetNativeETHBalance(ctx context.Context) (*big.Int, error) {
        wallet, err := e.walletAddress()
        if err != nil {
                return nil, err
        }
        res, err := e.rpc.call(ctx, "eth_getBalance", wallet, "latest")
        if err != nil {
                return nil, err
        }
        var s string
        json.Unmarshal(res, &s)
        n := new(big.Int)
        n.SetString(strings.TrimPrefix(s, "0x"), 16)
        return n, nil
}

// GetWETHBalanceWei returns the wallet's WETH token balance in wei.
func (e *Executor) GetWETHBalanceWei(ctx context.Context) (*big.Int, error) {
        wallet, err := e.walletAddress()
        if err != nil {
                return nil, err
        }
        return e.getTokenBalance(ctx, WETHAddr, wallet)
}

// WrapETH calls WETH.deposit() to convert native ETH → WETH.
// amountWei is the exact amount to wrap; caller is responsible for leaving a gas reserve.
func (e *Executor) WrapETH(ctx context.Context, amountWei *big.Int) (*SwapResult, error) {
        if amountWei == nil || amountWei.Sign() <= 0 {
                return nil, fmt.Errorf("WrapETH: amount must be positive")
        }
        privKey, err := loadPrivKey()
        if err != nil {
                return nil, fmt.Errorf("WrapETH: %w", err)
        }
        walletAddr, err := e.walletAddress()
        if err != nil {
                return nil, fmt.Errorf("WrapETH wallet: %w", err)
        }

        // WETH deposit() selector: 0xd0e30db0 (no arguments, ETH sent as value)
        data := []byte{0xd0, 0xe3, 0x0d, 0xb0}

        nonce, err := e.rpc.getNonce(ctx, walletAddr)
        if err != nil {
                return nil, fmt.Errorf("WrapETH nonce: %w", err)
        }
        priorityFee, maxFee := e.queryGasPrice(ctx)

        rawTx, err := buildAndSignTx(
                big.NewInt(BaseChainID), nonce,
                priorityFee, maxFee,
                big.NewInt(50_000), // WETH deposit is cheap (~25k gas, 50k to be safe)
                WETHAddr, amountWei, data, privKey,
        )
        if err != nil {
                return nil, fmt.Errorf("WrapETH sign: %w", err)
        }
        txHash, err := e.rpc.sendRawTx(ctx, rawTx)
        if err != nil {
                return nil, fmt.Errorf("WrapETH send: %w", err)
        }
        receipt, err := e.rpc.waitReceipt(ctx, txHash, 60*time.Second)
        if err != nil {
                return nil, fmt.Errorf("WrapETH receipt: %w", err)
        }
        if receipt.Status == "0x0" {
                return nil, fmt.Errorf("WrapETH tx reverted (txHash=%s)", txHash)
        }
        gasUsed := new(big.Int)
        gasUsed.SetString(strings.TrimPrefix(receipt.GasUsed, "0x"), 16)
        log.Printf("💎 [WRAP] %.6f ETH → WETH tx=%s… gas=%d", float64(amountWei.Int64())/1e18, txHash[:12], gasUsed.Uint64())
        return &SwapResult{TxHash: txHash, GasUsed: gasUsed.Uint64()}, nil
}

// GetTokenBalanceWei returns any ERC20 token balance in its native decimals.
func (e *Executor) GetTokenBalanceWei(ctx context.Context, tokenAddr string) (*big.Int, error) {
        wallet, err := e.walletAddress()
        if err != nil {
                return nil, err
        }
        return e.getTokenBalance(ctx, tokenAddr, wallet)
}

func (e *Executor) getTokenBalance(ctx context.Context, tokenAddr, walletAddr string) (*big.Int, error) {
        data := balanceOfCalldata(walletAddr)
        result, err := e.rpc.ethCall(ctx, tokenAddr, data)
        if err != nil {
                return nil, err
        }
        return parseBigInt(result), nil
}

func loadPrivKey() (*secp256k1.PrivateKey, error) {
        raw := strings.TrimSpace(os.Getenv("WALLET_PRIVATE_KEY"))
        if raw == "" {
                return nil, fmt.Errorf("WALLET_PRIVATE_KEY not set")
        }
        raw = strings.TrimPrefix(raw, "0x")
        privBytes, err := hex.DecodeString(raw)
        if err != nil || len(privBytes) != 32 {
                return nil, fmt.Errorf("WALLET_PRIVATE_KEY must be a 32-byte hex string")
        }
        return secp256k1.PrivKeyFromBytes(privBytes), nil
}

// ── Crypto helpers ────────────────────────────────────────────────────────────

func keccak256(data []byte) []byte {
        h := sha3.NewLegacyKeccak256()
        h.Write(data)
        return h.Sum(nil)
}

// ── ABI encoding ──────────────────────────────────────────────────────────────

func padLeft32(b []byte) []byte {
        if len(b) >= 32 {
                return b[len(b)-32:]
        }
        padded := make([]byte, 32)
        copy(padded[32-len(b):], b)
        return padded
}

func abiAddr(addr string) []byte {
        addr = strings.TrimPrefix(addr, "0x")
        if len(addr) < 40 {
                addr = strings.Repeat("0", 40-len(addr)) + addr
        }
        b, _ := hex.DecodeString(addr)
        return padLeft32(b)
}

func abiUint256(n *big.Int) []byte {
        if n == nil {
                return make([]byte, 32)
        }
        return padLeft32(n.Bytes())
}

// approve(address,uint256) selector: 0x095ea7b3
func approveCalldata(spender string, amount *big.Int) []byte {
        d := []byte{0x09, 0x5e, 0xa7, 0xb3}
        d = append(d, abiAddr(spender)...)
        d = append(d, abiUint256(amount)...)
        return d
}

// allowance(address,address) selector: 0xdd62ed3e
func allowanceCalldata(owner, spender string) []byte {
        d := []byte{0xdd, 0x62, 0xed, 0x3e}
        d = append(d, abiAddr(owner)...)
        d = append(d, abiAddr(spender)...)
        return d
}

// balanceOf(address) selector: 0x70a08231
func balanceOfCalldata(account string) []byte {
        d := []byte{0x70, 0xa0, 0x82, 0x31}
        d = append(d, abiAddr(account)...)
        return d
}

// exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))
// SwapRouter02 selector: 0x04e45aaf
// exactInputCalldata encodes a UniV3 exactInput multihop swap.
// path is the packed bytes: tokenA ++ fee(3B) ++ tokenB ++ fee(3B) ++ tokenC ...
// selector: keccak256("exactInput((bytes,address,uint256,uint256))")[:4] = 0xb858183f
func exactInputCalldata(path []byte, recipient string, amountIn, amountOutMin *big.Int) []byte {
        d := []byte{0xb8, 0x58, 0x18, 0x3f}
        // struct offset = 32
        d = append(d, abiUint256(big.NewInt(32))...)
        // tuple: (bytes path, address recipient, uint256 amountIn, uint256 amountOutMin)
        // path is dynamic — offset within tuple = 128 (4 * 32)
        d = append(d, abiUint256(big.NewInt(128))...)     // bytes offset
        d = append(d, abiAddr(recipient)...)
        d = append(d, abiUint256(amountIn)...)
        d = append(d, abiUint256(amountOutMin)...)
        // encode bytes: length + data padded to 32 bytes
        d = append(d, abiUint256(big.NewInt(int64(len(path))))...)
        padded := make([]byte, ((len(path)+31)/32)*32)
        copy(padded, path)
        d = append(d, padded...)
        return d
}

// v3MultihopPath packs the UniV3 path bytes: tokenA ++ fee(3 bytes big-endian) ++ tokenB
func v3MultihopPath(tokenA string, fee uint32, tokenB string) []byte {
        a, _ := hex.DecodeString(strings.TrimPrefix(tokenA, "0x"))
        b, _ := hex.DecodeString(strings.TrimPrefix(tokenB, "0x"))
        feeBig := []byte{byte(fee >> 16), byte(fee >> 8), byte(fee)}
        path := make([]byte, 0, 43)
        path = append(path, a...)
        path = append(path, feeBig...)
        path = append(path, b...)
        return path
}

// v3MultihopPath3 packs a 3-token V3 path: tokenA ++ fee1(3B) ++ tokenMid ++ fee2(3B) ++ tokenB
func v3MultihopPath3(tokenA string, fee1 uint32, tokenMid string, fee2 uint32, tokenB string) []byte {
        a, _ := hex.DecodeString(strings.TrimPrefix(tokenA, "0x"))
        mid, _ := hex.DecodeString(strings.TrimPrefix(tokenMid, "0x"))
        b, _ := hex.DecodeString(strings.TrimPrefix(tokenB, "0x"))
        f1 := []byte{byte(fee1 >> 16), byte(fee1 >> 8), byte(fee1)}
        f2 := []byte{byte(fee2 >> 16), byte(fee2 >> 8), byte(fee2)}
        path := make([]byte, 0, 66)
        path = append(path, a...)
        path = append(path, f1...)
        path = append(path, mid...)
        path = append(path, f2...)
        path = append(path, b...)
        return path
}

func exactInputSingleCalldata(tokenIn, tokenOut string, fee uint32, recipient string, amountIn, amountOutMin *big.Int) []byte {
        d := []byte{0x04, 0xe4, 0x5a, 0xaf}
        d = append(d, abiAddr(tokenIn)...)
        d = append(d, abiAddr(tokenOut)...)
        d = append(d, abiUint256(big.NewInt(int64(fee)))...)
        d = append(d, abiAddr(recipient)...)
        d = append(d, abiUint256(amountIn)...)
        d = append(d, abiUint256(amountOutMin)...)
        d = append(d, make([]byte, 32)...) // sqrtPriceLimitX96 = 0
        return d
}

func parseBigInt(data []byte) *big.Int {
        if len(data) == 0 {
                return big.NewInt(0)
        }
        if len(data) > 32 {
                data = data[len(data)-32:]
        }
        return new(big.Int).SetBytes(data)
}

// ── RLP encoding ──────────────────────────────────────────────────────────────

func rlpEncodeBytes(b []byte) []byte {
        if len(b) == 0 {
                return []byte{0x80}
        }
        if len(b) == 1 && b[0] < 0x80 {
                return b
        }
        if len(b) <= 55 {
                return append([]byte{byte(0x80 + len(b))}, b...)
        }
        lb := minBytes(len(b))
        h := append([]byte{byte(0xb7 + len(lb))}, lb...)
        return append(h, b...)
}

func rlpEncodeInt(n *big.Int) []byte {
        if n == nil || n.Sign() == 0 {
                return []byte{0x80}
        }
        return rlpEncodeBytes(n.Bytes())
}

func rlpEncodeList(items ...[]byte) []byte {
        var payload []byte
        for _, item := range items {
                payload = append(payload, item...)
        }
        if len(payload) <= 55 {
                return append([]byte{byte(0xc0 + len(payload))}, payload...)
        }
        lb := minBytes(len(payload))
        h := append([]byte{byte(0xf7 + len(lb))}, lb...)
        return append(h, payload...)
}

func minBytes(n int) []byte {
        if n == 0 {
                return []byte{0}
        }
        var b []byte
        for n > 0 {
                b = append([]byte{byte(n & 0xff)}, b...)
                n >>= 8
        }
        return b
}

// ── Transaction signing ───────────────────────────────────────────────────────

func buildAndSignTx(chainID, nonce, maxPriorityFee, maxFee, gasLimit *big.Int,
        to string, value *big.Int, data []byte, privKey *secp256k1.PrivateKey) ([]byte, error) {

        toStr := strings.TrimPrefix(to, "0x")
        toBytes, err := hex.DecodeString(toStr)
        if err != nil || len(toBytes) != 20 {
                return nil, fmt.Errorf("invalid 'to' address: %s", to)
        }

        // Fields for signing hash (unsigned tx)
        unsignedFields := rlpEncodeList(
                rlpEncodeInt(chainID),
                rlpEncodeInt(nonce),
                rlpEncodeInt(maxPriorityFee),
                rlpEncodeInt(maxFee),
                rlpEncodeInt(gasLimit),
                rlpEncodeBytes(toBytes),
                rlpEncodeInt(value),
                rlpEncodeBytes(data),
                rlpEncodeList(), // empty access list
        )

        // EIP-1559 signing hash: keccak256(0x02 || rlp_unsigned)
        signingPayload := append([]byte{0x02}, unsignedFields...)
        sigHash := keccak256(signingPayload)

        // Sign with secp256k1
        // SignCompact with compress=true → byte[0] = 31 + recid
        compactSig := ecdsa.SignCompact(privKey, sigHash, true)
        recid := int(compactSig[0]) - 31
        if recid < 0 || recid > 1 {
                return nil, fmt.Errorf("unexpected recovery id: %d", recid)
        }
        r := new(big.Int).SetBytes(compactSig[1:33])
        s := new(big.Int).SetBytes(compactSig[33:65])

        // Signed tx
        signedFields := rlpEncodeList(
                rlpEncodeInt(chainID),
                rlpEncodeInt(nonce),
                rlpEncodeInt(maxPriorityFee),
                rlpEncodeInt(maxFee),
                rlpEncodeInt(gasLimit),
                rlpEncodeBytes(toBytes),
                rlpEncodeInt(value),
                rlpEncodeBytes(data),
                rlpEncodeList(), // empty access list
                rlpEncodeInt(big.NewInt(int64(recid))),
                rlpEncodeInt(r),
                rlpEncodeInt(s),
        )

        return append([]byte{0x02}, signedFields...), nil
}

// ── RPC client ────────────────────────────────────────────────────────────────

type rpcClient struct {
        url        string
        httpClient *http.Client
}

type rpcReq struct {
        JSONRPC string        `json:"jsonrpc"`
        Method  string        `json:"method"`
        Params  []interface{} `json:"params"`
        ID      int           `json:"id"`
}

type rpcResp struct {
        Result json.RawMessage `json:"result"`
        Error  *struct {
                Code    int    `json:"code"`
                Message string `json:"message"`
        } `json:"error"`
}

func (c *rpcClient) call(ctx context.Context, method string, params ...interface{}) (json.RawMessage, error) {
        body, _ := json.Marshal(rpcReq{JSONRPC: "2.0", Method: method, Params: params, ID: 1})
        req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url, bytes.NewReader(body))
        if err != nil {
                return nil, err
        }
        req.Header.Set("Content-Type", "application/json")
        resp, err := c.httpClient.Do(req)
        if err != nil {
                return nil, err
        }
        defer resp.Body.Close()
        var r rpcResp
        if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
                return nil, err
        }
        if r.Error != nil {
                return nil, fmt.Errorf("RPC %d: %s", r.Error.Code, r.Error.Message)
        }
        return r.Result, nil
}

func (c *rpcClient) getNonce(ctx context.Context, addr string) (*big.Int, error) {
        res, err := c.call(ctx, "eth_getTransactionCount", addr, "latest")
        if err != nil {
                return nil, err
        }
        var s string
        json.Unmarshal(res, &s)
        n := new(big.Int)
        n.SetString(strings.TrimPrefix(s, "0x"), 16)
        return n, nil
}

func (c *rpcClient) ethCall(ctx context.Context, to string, data []byte) ([]byte, error) {
        res, err := c.call(ctx, "eth_call", map[string]interface{}{
                "to":   to,
                "data": "0x" + hex.EncodeToString(data),
        }, "latest")
        if err != nil {
                return nil, err
        }
        var s string
        json.Unmarshal(res, &s)
        s = strings.TrimPrefix(s, "0x")
        if s == "" {
                return []byte{}, nil
        }
        return hex.DecodeString(s)
}

func (c *rpcClient) sendRawTx(ctx context.Context, rawTx []byte) (string, error) {
        res, err := c.call(ctx, "eth_sendRawTransaction", "0x"+hex.EncodeToString(rawTx))
        if err != nil {
                return "", err
        }
        var txHash string
        json.Unmarshal(res, &txHash)
        return txHash, nil
}

type txReceipt struct {
        Status  string `json:"status"`
        GasUsed string `json:"gasUsed"`
}

func (c *rpcClient) waitReceipt(ctx context.Context, txHash string, timeout time.Duration) (*txReceipt, error) {
        deadline := time.Now().Add(timeout)
        for time.Now().Before(deadline) {
                select {
                case <-ctx.Done():
                        return nil, ctx.Err()
                default:
                }
                res, err := c.call(ctx, "eth_getTransactionReceipt", txHash)
                if err == nil && res != nil && string(res) != "null" {
                        var receipt txReceipt
                        if err := json.Unmarshal(res, &receipt); err == nil && receipt.Status != "" {
                                return &receipt, nil
                        }
                }
                time.Sleep(2 * time.Second)
        }
        return nil, fmt.Errorf("receipt timeout after %s for tx %s", timeout, txHash)
}
