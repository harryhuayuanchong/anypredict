/**
 * Swap native USDC → USDC.e on Polygon via Relay Protocol
 * Supports gasless execution (no POL needed)
 */
const { ethers } = require("ethers");
require("dotenv").config({ path: ".env.local" });

const NATIVE_USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const POLYGON_CHAIN_ID = 137;

const pk = process.env.POLYMARKET_PRIVATE_KEY;
if (!pk) {
  console.log("POLYMARKET_PRIVATE_KEY not found in .env.local");
  process.exit(1);
}

const rpc =
  process.env.POLYMARKET_RPC_URL ||
  (process.env.DRPC_API_KEY
    ? `https://lb.drpc.live/polygon/${process.env.DRPC_API_KEY}`
    : null) ||
  "https://polygon-bor-rpc.publicnode.com";

const provider = new ethers.providers.StaticJsonRpcProvider(
  { url: rpc, skipFetchSetup: true },
  { chainId: POLYGON_CHAIN_ID, name: "matic" }
);
const wallet = new ethers.Wallet(pk, provider);

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

async function main() {
  const address = await wallet.getAddress();
  const nativeUsdc = new ethers.Contract(NATIVE_USDC, ERC20_ABI, provider);
  const usdce = new ethers.Contract(USDC_E, ERC20_ABI, provider);

  const balance = await nativeUsdc.balanceOf(address);
  const decimals = await nativeUsdc.decimals();
  const pol = await provider.getBalance(address);

  console.log("");
  console.log("  Relay USDC → USDC.e Swap");
  console.log("  ─────────────────────────────");
  console.log("  Wallet:       ", address);
  console.log("  Native USDC:  ", ethers.utils.formatUnits(balance, decimals));
  console.log("  USDC.e:       ", ethers.utils.formatUnits(await usdce.balanceOf(address), 6));
  console.log("  POL (gas):    ", ethers.utils.formatEther(pol));
  console.log("");

  if (balance.isZero()) {
    console.log("  No native USDC to swap. Exiting.");
    return;
  }

  const amountRaw = balance.toString();
  const amountFormatted = ethers.utils.formatUnits(balance, decimals);

  // Step 1: Get quote from Relay
  console.log(`  Requesting Relay quote for ${amountFormatted} USDC → USDC.e ...`);

  const quoteBody = {
    user: address,
    origins: [
      {
        chainId: POLYGON_CHAIN_ID,
        currency: NATIVE_USDC,
        amount: amountRaw,
      },
    ],
    destinationCurrency: USDC_E,
    destinationChainId: POLYGON_CHAIN_ID,
    tradeType: "EXACT_INPUT",
    recipient: address,
  };

  const quoteRes = await fetch("https://api.relay.link/execute/swap/multi-input", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(quoteBody),
  });

  if (!quoteRes.ok) {
    const errText = await quoteRes.text();
    console.error("  Relay quote failed:", quoteRes.status, errText);
    return;
  }

  const quote = await quoteRes.json();

  // Log quote details
  if (quote.fees) {
    console.log("  Relay fees:", JSON.stringify(quote.fees, null, 2));
  }

  const steps = quote.steps || [];
  console.log(`  Steps to execute: ${steps.length}`);

  if (steps.length === 0) {
    console.log("  No steps returned from Relay. Check the quote response:");
    console.log(JSON.stringify(quote, null, 2));
    return;
  }

  // Step 2: Execute each step's transactions
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    console.log(`\n  Step ${i + 1}: ${step.id || step.action || "tx"}`);

    const items = step.items || [];
    for (let j = 0; j < items.length; j++) {
      const item = items[j];
      const txData = item.data || item.tx;

      if (!txData) {
        console.log(`    Item ${j + 1}: No transaction data, skipping`);
        continue;
      }

      console.log(`    Item ${j + 1}: Sending tx to ${txData.to} ...`);

      // Fetch current gas price from network and set adequate tip
      const feeData = await provider.getFeeData();
      const minTip = ethers.utils.parseUnits("30", "gwei"); // Polygon minimum ~25 gwei
      const maxFee = feeData.maxFeePerGas
        ? feeData.maxFeePerGas.mul(2)
        : ethers.utils.parseUnits("100", "gwei");

      const tx = {
        to: txData.to,
        data: txData.data,
        value: txData.value ? ethers.BigNumber.from(txData.value) : undefined,
        gasLimit: txData.gasLimit || txData.gas || 150_000,
        chainId: txData.chainId || POLYGON_CHAIN_ID,
        type: 2,
        maxPriorityFeePerGas: minTip,
        maxFeePerGas: maxFee.gt(minTip) ? maxFee : minTip.mul(3),
      };

      console.log(`    Gas tip: ${ethers.utils.formatUnits(tx.maxPriorityFeePerGas, "gwei")} gwei`);

      try {
        const txResponse = await wallet.sendTransaction(tx);
        console.log(`    Tx hash: ${txResponse.hash}`);
        console.log("    Waiting for confirmation...");
        const receipt = await txResponse.wait();
        console.log(`    Confirmed in block ${receipt.blockNumber} (gas used: ${receipt.gasUsed.toString()})`);

        // Check status with Relay if there's a check endpoint
        if (item.check) {
          console.log("    Checking status with Relay...");
          let attempts = 0;
          while (attempts < 30) {
            await new Promise((r) => setTimeout(r, 2000));
            const checkRes = await fetch(item.check.endpoint, {
              method: item.check.method || "GET",
              headers: { "Content-Type": "application/json" },
              body: item.check.body ? JSON.stringify(item.check.body) : undefined,
            });
            if (checkRes.ok) {
              const checkData = await checkRes.json();
              if (checkData.status === "success" || checkData.status === "completed") {
                console.log("    Relay confirmed: success");
                break;
              }
              console.log(`    Status: ${checkData.status || "pending"}`);
            }
            attempts++;
          }
        }
      } catch (err) {
        console.error(`    Transaction failed: ${err.message}`);
        if (err.message.includes("insufficient funds for gas")) {
          console.error("\n  ERROR: You need POL for gas. Relay may not sponsor gas for same-chain swaps.");
          console.error("  Send ~0.1 POL to", address, "first, then re-run this script.");
        }
        return;
      }
    }
  }

  // Step 3: Check final balances
  console.log("\n  ─────────────────────────────");
  console.log("  Final Balances:");
  console.log("  Native USDC: ", ethers.utils.formatUnits(await nativeUsdc.balanceOf(address), decimals));
  console.log("  USDC.e:      ", ethers.utils.formatUnits(await usdce.balanceOf(address), 6));
  console.log("  POL:         ", ethers.utils.formatEther(await provider.getBalance(address)));
  console.log("");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
