// example.ts
import { Connection, clusterApiUrl } from "@solana/web3.js";
import { SolanaLib } from "../src/lib/solanaLib";
import dotenv from "dotenv";
dotenv.config();

const service = new SolanaLib();
(async () => {
  const MINT = "2TCEpHj2FyXAxXzZzZngymsTYQU6BW4QjBgx7pjmYmCs";

  // Classify top holders
  const classifications = await service.classifyTokenHolders(MINT);
  if (!classifications.length) {
    console.log("No classified holders found.");
  } else {
    console.log("Classified Holders:");
    classifications.forEach((info, idx) => {
      console.log(`\nHolder #${idx + 1}`);
      console.log(JSON.stringify(info, null, 2));
    });
  }
})();
