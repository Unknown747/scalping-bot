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
        RouterV3Addr = "0x2626664c2603336E57B271c5C0b26F421741e481"
)

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

        // Check which fee tiers actually have a pool before sending any TX
        validFees, err := e.detectValidFeeTiers(ctx, WETHAddr, tokenAddr)
        if err != nil {
                log.Printf("⚠️  Pool detection error: %v — trying all fee tiers", err)
                validFees = feeTiers
        }
        if len(validFees) == 0 {
                return nil, fmt.Errorf("no Uniswap V3 pool found for %s on Base — token not tradeable", tokenAddr)
        }
        log.Printf("🔎 Pool check: %s valid fee tiers: %v", tokenAddr[:10], validFees)

        if err := e.ensureApproval(ctx, WETHAddr, RouterV3Addr, wallet, wethWei); err != nil {
                return nil, fmt.Errorf("WETH approval: %w", err)
        }

        // Fetch nonce once, increment locally for each retry to avoid nonce-too-low
        nonce, err := e.rpc.getNonce(ctx, wallet)
        if err != nil {
                return nil, fmt.Errorf("get nonce: %w", err)
        }

        var lastErr error
        for _, fee := range validFees {
                calldata := exactInputSingleCalldata(WETHAddr, tokenAddr, fee, wallet, wethWei, big.NewInt(0))
                result, err := e.executeSwapWithNonce(ctx, wallet, RouterV3Addr, calldata, nonce)
                if err == nil {
                        log.Printf("💱 [LIVE] BUY %s…%s fee=%d tx=%s…", tokenAddr[:6], tokenAddr[len(tokenAddr)-4:], fee, result.TxHash[:12])
                        return result, nil
                }
                log.Printf("⚠️  BUY fee=%d failed: %v", fee, err)
                lastErr = err
                // Increment nonce so next fee tier gets the next slot
                nonce = new(big.Int).Add(nonce, big.NewInt(1))
        }
        return nil, fmt.Errorf("all fee tiers failed for BUY: %w", lastErr)
}

func (e *Executor) Sell(ctx context.Context, tokenAddr string) (*SwapResult, error) {
        wallet, err := e.walletAddress()
        if err != nil {
                return nil, err
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

        // Check which fee tiers have a pool
        validFees, err := e.detectValidFeeTiers(ctx, tokenAddr, WETHAddr)
        if err != nil {
                log.Printf("⚠️  Pool detection error: %v — trying all fee tiers", err)
                validFees = feeTiers
        }
        if len(validFees) == 0 {
                return nil, fmt.Errorf("no Uniswap V3 pool found for %s — cannot sell", tokenAddr)
        }

        if err := e.ensureApproval(ctx, tokenAddr, RouterV3Addr, wallet, tokenBalance); err != nil {
                return nil, fmt.Errorf("token approval: %w", err)
        }

        // Fetch nonce once, increment locally for each retry
        nonce, err := e.rpc.getNonce(ctx, wallet)
        if err != nil {
                return nil, fmt.Errorf("get nonce: %w", err)
        }

        var lastErr error
        for _, fee := range validFees {
                calldata := exactInputSingleCalldata(tokenAddr, WETHAddr, fee, wallet, tokenBalance, big.NewInt(0))
                result, err := e.executeSwapWithNonce(ctx, wallet, RouterV3Addr, calldata, nonce)
                if err == nil {
                        log.Printf("💱 [LIVE] SELL %s…%s fee=%d tx=%s…", tokenAddr[:6], tokenAddr[len(tokenAddr)-4:], fee, result.TxHash[:12])
                        return result, nil
                }
                log.Printf("⚠️  SELL fee=%d failed: %v", fee, err)
                lastErr = err
                nonce = new(big.Int).Add(nonce, big.NewInt(1))
        }
        return nil, fmt.Errorf("all fee tiers failed for SELL: %w", lastErr)
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

// executeSwapWithNonce signs and sends a swap TX using a caller-supplied nonce.
// This avoids the nonce-too-low problem when retrying across multiple fee tiers
// in a single block: the caller increments the nonce locally between retries.
func (e *Executor) executeSwapWithNonce(ctx context.Context, walletAddr, routerAddr string, calldata []byte, nonce *big.Int) (*SwapResult, error) {
        privKey, err := loadPrivKey()
        if err != nil {
                return nil, err
        }
        priorityFee, maxFee := e.queryGasPrice(ctx)
        rawTx, err := buildAndSignTx(
                big.NewInt(BaseChainID), nonce,
                priorityFee,
                maxFee,
                big.NewInt(250_000),
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
                return nil, fmt.Errorf("tx reverted (txHash=%s) — insufficient liquidity or pool issue", txHash)
        }
        gasUsed := new(big.Int)
        gasUsed.SetString(strings.TrimPrefix(receipt.GasUsed, "0x"), 16)
        return &SwapResult{TxHash: txHash, GasUsed: gasUsed.Uint64()}, nil
}

// detectValidFeeTiers calls Uniswap V3 Factory.getPool() for each fee tier and
// returns only those where a real pool (non-zero address) exists on Base.
// Factory: 0x33128a8fC17869897dcE68Ed026d694621f6FDfD (Uniswap V3 on Base)
func (e *Executor) detectValidFeeTiers(ctx context.Context, tokenA, tokenB string) ([]uint32, error) {
        const factoryAddr = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD"
        var valid []uint32
        for _, fee := range feeTiers {
                data := getPoolCalldata(tokenA, tokenB, fee)
                result, err := e.rpc.ethCall(ctx, factoryAddr, data)
                if err != nil {
                        continue
                }
                if len(result) >= 20 {
                        // Pool address is in the last 20 bytes; zero address = no pool
                        addr := result[len(result)-20:]
                        allZero := true
                        for _, b := range addr {
                                if b != 0 {
                                        allZero = false
                                        break
                                }
                        }
                        if !allZero {
                                valid = append(valid, fee)
                        }
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

func (e *Executor) ensureApproval(ctx context.Context, tokenAddr, spender, owner string, amount *big.Int) error {
        alwData := allowanceCalldata(owner, spender)
        alwResult, err := e.rpc.ethCall(ctx, tokenAddr, alwData)
        if err != nil {
                return fmt.Errorf("allowance check: %w", err)
        }
        if parseBigInt(alwResult).Cmp(amount) >= 0 {
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
        priorityFee, maxFee := e.queryGasPrice(ctx)
        rawTx, err := buildAndSignTx(
                big.NewInt(BaseChainID), nonce,
                priorityFee,
                maxFee,
                big.NewInt(65_000), // ERC20 approve on Base
                tokenAddr, big.NewInt(0), calldata, privKey,
        )
        if err != nil {
                return err
        }
        txHash, err := e.rpc.sendRawTx(ctx, rawTx)
        if err != nil {
                return err
        }
        receipt, err := e.rpc.waitReceipt(ctx, txHash, 60*time.Second)
        if err != nil {
                return err
        }
        if receipt.Status == "0x0" {
                return fmt.Errorf("approval tx reverted (txHash=%s)", txHash)
        }
        log.Printf("✅ Approval confirmed: %s tx=%s…", tokenAddr[:10], txHash[:12])
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
