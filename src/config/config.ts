import dotenv from "dotenv";
dotenv.config();

export const CONFIG = {
  HELIUS_API_KEY: process.env.HELIUS_API_KEY, // Get from https://helius.xyz
  BIRDEYE_API_KEY: process.env.BIRDEYE_API_KEY, // Get from https://birdeye.so
  SOLSCAN_API_KEY: process.env.SOLSCAN_API_KEY, // Get from https://solscan.io
  SOLANA_RPC_ENDPOINT:
    process.env.SOLANA_RPC_ENDPOINT || "https://api.mainnet-beta.solana.com", // Default to mainnet
  TOKEN_MINT: process.env.TOKEN_MINT,
};
