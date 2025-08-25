// example.ts
import { Connection, clusterApiUrl } from "@solana/web3.js";
import { SolanaLib } from "../src/lib/solanaLib";
import dotenv from "dotenv";
dotenv.config();

const service = new SolanaLib();
(async () => {
  const MINT = "2TCEpHj2FyXAxXzZzZngymsTYQU6BW4QjBgx7pjmYmCs";

  // // Fast lower-bound from top 20
  // const splitTop20 = await service.getSupplySplitTop20(MINT);
  // service["logSupplySplitTop20"](splitTop20);

  // // Accurate full scan (may take longer on very large holder sets)
  // const splitFull = await service.getSupplySplitFull(MINT);
  // service["logSupplySplitFull"](splitFull);

  await service.generate(MINT, { includeFullSplit: true });
  // Classify top holders
  // const classifications = await service.classifyTokenHolders(MINT);

  // if (!classifications.length) {
  //   console.log("No classified holders found.");
  // } else {
  //   console.log("Classified Holders:");
  //   classifications.forEach((info, idx) => {
  //     console.log(`\nHolder #${idx + 1}`);
  //     console.log(JSON.stringify(info, null, 2));
  //   });
  // }
})();
