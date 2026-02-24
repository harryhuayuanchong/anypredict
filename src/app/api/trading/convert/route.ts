import { NextResponse } from "next/server";
import { ethers } from "ethers";

/**
 * POST /api/trading/convert
 * Swap native USDC → USDC.e on Polygon via Relay Protocol
 */

const NATIVE_USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const POLYGON_CHAIN_ID = 137;

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

function resolveRpcUrl(): string {
  if (process.env.POLYMARKET_RPC_URL) return process.env.POLYMARKET_RPC_URL;
  if (process.env.DRPC_API_KEY)
    return `https://lb.drpc.live/polygon/${process.env.DRPC_API_KEY}`;
  return "https://polygon-bor-rpc.publicnode.com";
}

function getWalletAndProvider() {
  const pk = process.env.POLYMARKET_PRIVATE_KEY;
  if (!pk) throw new Error("POLYMARKET_PRIVATE_KEY not set");

  const rpcUrl = resolveRpcUrl();
  const connection: ethers.utils.ConnectionInfo = {
    url: rpcUrl,
    skipFetchSetup: true,
  };
  const provider = new ethers.providers.StaticJsonRpcProvider(connection, {
    chainId: POLYGON_CHAIN_ID,
    name: "matic",
  });
  const wallet = new ethers.Wallet(pk, provider);
  return { wallet, provider };
}

export async function POST() {
  try {
    const { wallet, provider } = getWalletAndProvider();
    const address = await wallet.getAddress();

    // Check native USDC balance
    const nativeUsdc = new ethers.Contract(NATIVE_USDC, ERC20_ABI, provider);
    const balance = await nativeUsdc.balanceOf(address);

    if (balance.isZero()) {
      return NextResponse.json(
        { error: "No native USDC to convert" },
        { status: 400 }
      );
    }

    const decimals = await nativeUsdc.decimals();
    const amountFormatted = ethers.utils.formatUnits(balance, decimals);

    // Get quote from Relay
    const quoteRes = await fetch(
      "https://api.relay.link/execute/swap/multi-input",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user: address,
          origins: [
            {
              chainId: POLYGON_CHAIN_ID,
              currency: NATIVE_USDC,
              amount: balance.toString(),
            },
          ],
          destinationCurrency: USDC_E,
          destinationChainId: POLYGON_CHAIN_ID,
          tradeType: "EXACT_INPUT",
          recipient: address,
        }),
      }
    );

    if (!quoteRes.ok) {
      const errText = await quoteRes.text();
      console.error("Relay quote failed:", quoteRes.status, errText);
      return NextResponse.json(
        { error: `Relay quote failed: ${errText}` },
        { status: 502 }
      );
    }

    const quote = await quoteRes.json();
    const steps = quote.steps || [];

    if (steps.length === 0) {
      return NextResponse.json(
        { error: "Relay returned no swap steps" },
        { status: 502 }
      );
    }

    // Execute each step
    const txHashes: string[] = [];
    for (const step of steps) {
      const items = step.items || [];
      for (const item of items) {
        const txData = item.data || item.tx;
        if (!txData) continue;

        // Set adequate gas for Polygon
        const feeData = await provider.getFeeData();
        const minTip = ethers.utils.parseUnits("30", "gwei");
        const maxFee = feeData.maxFeePerGas
          ? feeData.maxFeePerGas.mul(2)
          : ethers.utils.parseUnits("100", "gwei");

        const tx = {
          to: txData.to,
          data: txData.data,
          value: txData.value
            ? ethers.BigNumber.from(txData.value)
            : undefined,
          gasLimit: txData.gasLimit || txData.gas || 150_000,
          chainId: txData.chainId || POLYGON_CHAIN_ID,
          type: 2,
          maxPriorityFeePerGas: minTip,
          maxFeePerGas: maxFee.gt(minTip) ? maxFee : minTip.mul(3),
        };

        const txResponse = await wallet.sendTransaction(tx);
        await txResponse.wait();
        txHashes.push(txResponse.hash);
      }
    }

    // Check final USDC.e balance
    const usdce = new ethers.Contract(USDC_E, ERC20_ABI, provider);
    const usdceBalance = await usdce.balanceOf(address);
    const usdceFormatted = parseFloat(
      ethers.utils.formatUnits(usdceBalance, 6)
    );

    // Check remaining native USDC
    const remainingUsdc = await nativeUsdc.balanceOf(address);
    const remainingFormatted = parseFloat(
      ethers.utils.formatUnits(remainingUsdc, decimals)
    );

    // Relay fee
    const relayerFee = quote.fees?.relayer?.amountFormatted || "0";

    return NextResponse.json({
      success: true,
      converted: parseFloat(amountFormatted),
      received: usdceFormatted,
      fee: parseFloat(relayerFee),
      remaining_native_usdc: remainingFormatted,
      tx_hashes: txHashes,
    });
  } catch (err) {
    console.error("Convert error:", err);
    const msg = err instanceof Error ? err.message : "Conversion failed";
    if (msg.includes("insufficient funds for gas")) {
      return NextResponse.json(
        { error: "Not enough POL for gas. Send ~0.1 POL to your wallet first." },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
