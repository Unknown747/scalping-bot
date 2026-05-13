// cmd/testswap/main.go
// ─────────────────────────────────────────────────────────────────────────────
// On-chain Buy/Sell swap test for Base Network (Uniswap V3)
// Usage:  go run cmd/testswap/main.go
// ─────────────────────────────────────────────────────────────────────────────
package main

import (
	"context"
	"fmt"
	"log"
	"math/big"
	"os"
	"time"

	swappkg "meme-scalper-ai/internal/swap"
)

const (
	// DEGEN — well-known Base meme token with deep Uniswap V3 liquidity
	testTokenAddr = "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed"
	testTokenName = "DEGEN"

	// Primary RPC
	rpcURL = "https://1rpc.io/base"

	// Test trade size: 0.0001 WETH (~$0.30 at $3 000/ETH) — tiny, safe for mainnet test
	testWETH = 0.0001
)

func weiToFloat(w *big.Int) float64 {
	f, _ := new(big.Float).Quo(
		new(big.Float).SetInt(w),
		new(big.Float).SetFloat64(1e18),
	).Float64()
	return f
}

func floatToWei(f float64) *big.Int {
	w := new(big.Int)
	new(big.Float).SetFloat64(f * 1e18).Int(w)
	return w
}

func banner(label, color string) {
	sym := "🟢"
	if color == "red" {
		sym = "🔴"
	} else if color == "blue" {
		sym = "🔵"
	}
	line := "═══════════════════════════════════════════════"
	fmt.Printf("\n%s %s\n   %s\n%s %s\n\n", sym, line, label, sym, line)
}

func main() {
	log.SetFlags(0)

	exec := swappkg.NewExecutor(rpcURL)
	ctx := context.Background()

	banner("MemeScalper AI Pro — Swap Test (Base Mainnet)", "blue")

	// ── 1. Wallet info ────────────────────────────────────────────────────────
	walletAddr, err := exec.WalletAddr()
	if err != nil {
		log.Fatalf("❌  Cannot derive wallet address: %v\n   ➜  Check WALLET_PRIVATE_KEY secret", err)
	}
	fmt.Printf("🔑  Wallet  : %s\n", walletAddr)
	fmt.Printf("🌐  Network : Base Mainnet (Chain 8453)\n")
	fmt.Printf("🔗  BaseScan: https://basescan.org/address/%s\n\n", walletAddr)

	// ── 2. Balances ───────────────────────────────────────────────────────────
	ethBal, err := exec.GetNativeETHBalance(ctx)
	if err != nil {
		log.Printf("⚠️   ETH balance check failed: %v", err)
		ethBal = big.NewInt(0)
	}
	ethF := weiToFloat(ethBal)

	wethBal, err := exec.GetWETHBalanceWei(ctx)
	if err != nil {
		log.Printf("⚠️   WETH balance check failed: %v", err)
		wethBal = big.NewInt(0)
	}
	wethF := weiToFloat(wethBal)

	fmt.Printf("💎  ETH     : %.8f ETH\n", ethF)
	fmt.Printf("💰  WETH    : %.8f WETH\n", wethF)
	fmt.Printf("🎯  Test amt: %.8f WETH (≈$%.4f @ $3000/ETH)\n\n", testWETH, testWETH*3000)

	// ── 3. Pre-flight checks ──────────────────────────────────────────────────
	if wethF < testWETH {
		fmt.Printf("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")
		fmt.Printf("⚠️   INSUFFICIENT WETH BALANCE\n")
		fmt.Printf("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")
		fmt.Printf("    Need  : %.8f WETH\n", testWETH)
		fmt.Printf("    Have  : %.8f WETH\n", wethF)
		if ethF > testWETH {
			fmt.Printf("\n✅  You have enough native ETH.\n")
			fmt.Printf("    Wrap ETH → WETH on Uniswap or use the WETH contract:\n")
			fmt.Printf("    https://basescan.org/address/0x4200000000000000000000000000000000000006\n")
			fmt.Printf("    Call  deposit()  and send %.4f ETH with the tx.\n\n", testWETH+0.0005)
		} else {
			fmt.Printf("\n❌  Wallet also has insufficient ETH.\n")
			fmt.Printf("    Fund the wallet and then wrap some ETH to WETH.\n")
			fmt.Printf("    Wallet: %s\n\n", walletAddr)
		}
		os.Exit(1)
	}

	// ── 4. BUY ────────────────────────────────────────────────────────────────
	banner(fmt.Sprintf("BUY  %s  |  %.8f WETH", testTokenName, testWETH), "green")

	buyCtx, buyCancel := context.WithTimeout(ctx, 120*time.Second)
	defer buyCancel()

	buyResult, err := exec.Buy(buyCtx, testTokenAddr, floatToWei(testWETH))
	if err != nil {
		log.Fatalf("❌  BUY FAILED: %v", err)
	}

	fmt.Printf("✅  BUY SUCCESS\n")
	fmt.Printf("   Tx Hash : %s\n", buyResult.TxHash)
	fmt.Printf("   Gas Used: %d\n", buyResult.GasUsed)
	fmt.Printf("   BaseScan: https://basescan.org/tx/%s\n\n", buyResult.TxHash)

	// Check token balance received
	time.Sleep(3 * time.Second)
	tokBal, err := exec.GetTokenBalanceWei(ctx, testTokenAddr)
	if err != nil || tokBal == nil || tokBal.Sign() == 0 {
		fmt.Printf("⚠️   Could not read %s balance after buy (may still be propagating)\n\n", testTokenName)
	} else {
		tokF, _ := new(big.Float).Quo(
			new(big.Float).SetInt(tokBal),
			new(big.Float).SetFloat64(1e18),
		).Float64()
		fmt.Printf("🏦  %s received: %.4f\n\n", testTokenName, tokF)
	}

	// ── 5. Brief pause ────────────────────────────────────────────────────────
	fmt.Printf("⏳  Waiting 8 seconds before sell...\n\n")
	time.Sleep(8 * time.Second)

	// ── 6. SELL ───────────────────────────────────────────────────────────────
	banner(fmt.Sprintf("SELL %s  |  full balance → WETH", testTokenName), "red")

	sellCtx, sellCancel := context.WithTimeout(ctx, 120*time.Second)
	defer sellCancel()

	sellResult, err := exec.Sell(sellCtx, testTokenAddr)
	if err != nil {
		log.Fatalf("❌  SELL FAILED: %v", err)
	}

	fmt.Printf("✅  SELL SUCCESS\n")
	fmt.Printf("   Tx Hash : %s\n", sellResult.TxHash)
	fmt.Printf("   Gas Used: %d\n", sellResult.GasUsed)
	fmt.Printf("   BaseScan: https://basescan.org/tx/%s\n\n", sellResult.TxHash)

	// ── 7. Final report ───────────────────────────────────────────────────────
	time.Sleep(3 * time.Second)
	finalWETH, err := exec.GetWETHBalanceWei(ctx)
	if err != nil {
		finalWETH = big.NewInt(0)
	}
	finalF := weiToFloat(finalWETH)
	netWETH := finalF - wethF

	banner("SWAP TEST COMPLETE — SUMMARY", "blue")
	fmt.Printf("   WETH Before : %.8f WETH\n", wethF)
	fmt.Printf("   WETH After  : %.8f WETH\n", finalF)
	fmt.Printf("   Net Change  : %+.8f WETH  (gas cost)\n\n", netWETH)
	fmt.Printf("   Buy  tx : https://basescan.org/tx/%s\n", buyResult.TxHash)
	fmt.Printf("   Sell tx : https://basescan.org/tx/%s\n\n", sellResult.TxHash)

	if sellResult.TxHash != "" && buyResult.TxHash != "" {
		fmt.Printf("🎉  Both swaps confirmed on-chain — executor is working!\n\n")
	}
}
