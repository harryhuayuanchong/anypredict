const { ethers } = require("ethers");
require("dotenv").config({ path: ".env.local" });

const pk = process.env.POLYMARKET_PRIVATE_KEY;
if (!pk) {
  console.log("POLYMARKET_PRIVATE_KEY not found in .env.local");
  process.exit(1);
}

const rpc = process.env.POLYMARKET_RPC_URL
  || (process.env.DRPC_API_KEY ? `https://lb.drpc.live/polygon/${process.env.DRPC_API_KEY}` : null)
  || "https://polygon-bor-rpc.publicnode.com";
const chainId = parseInt(process.env.POLYMARKET_CHAIN_ID || "137");
const provider = new ethers.providers.JsonRpcProvider(rpc, chainId);
const wallet = new ethers.Wallet(pk, provider);

const USDC = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const abi = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];
const usdc = new ethers.Contract(USDC, abi, provider);

(async () => {
  const address = await wallet.getAddress();
  const balance = await usdc.balanceOf(address);
  const decimals = await usdc.decimals();
  const matic = await provider.getBalance(address);

  console.log("");
  console.log("  Polymarket Wallet");
  console.log("  ─────────────────────────────");
  console.log("  Address:", address);
  console.log("  USDC.e:  $" + ethers.utils.formatUnits(balance, decimals));
  console.log("  MATIC:   " + ethers.utils.formatEther(matic));
  console.log("");
})();
