import dotenv from "dotenv";
dotenv.config();

export const CONFIG = {
  HELIUS_API_KEY: process.env.HELIUS_API_KEY, 
  BIRDEYE_API_KEY: process.env.BIRDEYE_API_KEY, 
  SOLSCAN_API_KEY: process.env.SOLSCAN_API_KEY, 
  SOLANA_RPC_ENDPOINT:
    process.env.SOLANA_RPC_ENDPOINT || "https://api.mainnet-beta.solana.com", 
  TOKEN_MINT: process.env.TOKEN_MINT,
};
