import { getMint, Mint } from "@solana/spl-token";
import axios from "axios";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  MintInfo,
  SolscanMetaDataResponse,
  WalletClassification,
  HolderInfo,
  WalletHistorySummary,
} from "../common/interface";
import { WalletCategory } from "../common/constants";
import { CONFIG } from "../config/config";

export class SolanaLib {
  private connection: Connection;

  constructor() {
    this.connection = new Connection(CONFIG.SOLANA_RPC_ENDPOINT, {
      commitment: "confirmed",
    });
  }

  async getMintInfo(mintAddr: string | PublicKey): Promise<MintInfo> {
    const mintKey =
      typeof mintAddr === "string" ? new PublicKey(mintAddr) : mintAddr;
    const mint = await getMint(this.connection, mintKey);

    return {
      address: mint.address.toBase58(),
      supply: Number(mint.supply) / 10 ** mint.decimals,
      decimals: mint.decimals,
      mintAuthority: mint.mintAuthority ? mint.mintAuthority.toBase58() : null,
      freezeAuthority: mint.freezeAuthority
        ? mint.freezeAuthority.toBase58()
        : null,
      raw: mint,
    };
  }

  // Using RPC
  async getTopHolders(
    mintAddr: string | PublicKey,
  ): Promise<HolderInfo[] | null> {
    const mintKey =
      typeof mintAddr === "string" ? new PublicKey(mintAddr) : mintAddr;

    // RPC returns up to 20 accounts sorted by balance (largest first)
    const { value } = await this.connection.getTokenLargestAccounts(mintKey);

    // Filter out zero balances
    const nonEmpty = value.filter((e) => BigInt(e.amount) > 0n);
    if (nonEmpty.length === 0) return null; // nothing left after filtering

    return nonEmpty.map((entry) => {
      const raw = BigInt(entry.amount);
      return {
        address: entry.address.toBase58(),
        rawBalance: raw,
        balance: Number(raw) / 10 ** entry.decimals,
        decimals: entry.decimals,
      };
    });
  }

  // account labeling : https://docs.solscan.io/transaction-details/labeling
  // using Solscan's metadata API
  async getAccountLabel(address: string): Promise<string | null> {
    try {
      const { data } = await axios.get<SolscanMetaDataResponse>(
        "https://public-api.solscan.io/account/metadata",
        {
          params: { address },
          headers: { token: CONFIG.SOLSCAN_API_KEY },
        },
      );
      // Only return when the call itself succeeded and a label exists
      return data.success && data.data?.account_label
        ? data.data.account_label
        : null;
    } catch (err) {
      return null;
    }
  }

  /** Analyse the 20 largest on-chain holders (non-empty accounts) and
   *  return an enriched, typed classification list. */
  async classifyTokenHolders(
    tokenMint: string,
  ): Promise<WalletClassification[]> {
    const mintInfo = await this.getMintInfo(
      typeof tokenMint === "string" ? new PublicKey(tokenMint) : tokenMint,
    );
    const supplyRaw = mintInfo.raw.supply;
    console.log(
      `Token Mint: ${mintInfo.address}, Supply: ${mintInfo.supply}, Decimals: ${mintInfo.decimals}`,
    );

    console.log("Fetching top token holders...");
    const holders = await this.getTopHolders(tokenMint);
    if (!holders) {
      console.log("No holders on this Token yet.");
    } else {
      console.log("Top Holders:", holders);
    }
    console.log(`Found ${holders?.length || 0} non-empty holders.`);

    const classifications: WalletClassification[] = [];

    if (!holders || holders.length === 0) {
      return classifications; // No holders to classify
    }

    for (const holder of holders) {
      // Get transaction history
      const history: WalletHistorySummary = await this.analyzeWalletHistory(
        holder.address,
        tokenMint,
      );

      // Classify the wallet
      const category = await this.classifyWallet(
        holder.address,
        holder.balance, // ui number
        holder.rawBalance, // bigint
        supplyRaw, // bigint
        history,
      );

      // Determine if diamond hand (never sold, held for >6 months)
      const ageDays =
        (Date.now() - history.firstTx.getTime()) / (1000 * 60 * 60 * 24);
      const isDiamondHand = !history.hasSold && ageDays > 180;

      const solscanLabel =
        (await this.getAccountLabel(holder.address)) || undefined;

      classifications.push({
        address: holder.address,
        category,
        balance: holder.balance,
        firstTransactionDate: history.firstTx,
        lastTransactionDate: history.lastTx,
        transactionCount: history.txCount,
        hasSold: history.hasSold,
        isDiamondHand,
        metadata: {
          label: solscanLabel,
          source: "automated_classification",
        },
      });

      // Rate limiting
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return classifications;
  }

  // async analyzeWalletHistory(
  //   walletAddress: string,
  //   tokenMint: string,
  // ): Promise<{
  //   firstTx: Date;
  //   lastTx: Date;
  //   txCount: number;
  //   hasSold: boolean;
  //   netFlow: number;
  // }> {
  //   try {
  //     // Using Helius enhanced transactions API
  //     const response = await axios.post(
  //       `https://api.helius.xyz/v0/addresses/${walletAddress}/transactions?api-key=${CONFIG.HELIUS_API_KEY}`,
  //       {
  //         type: "TOKEN_TRANSFER",
  //         mint: tokenMint,
  //       },
  //     );

  //     const transactions = response.data || [];

  //     if (transactions.length === 0) {
  //       return {
  //         firstTx: new Date(),
  //         lastTx: new Date(),
  //         txCount: 0,
  //         hasSold: false,
  //         netFlow: 0,
  //       };
  //     }

  //     let totalInflow = 0;
  //     let totalOutflow = 0;

  //     transactions.forEach((tx: any) => {
  //       if (tx.from === walletAddress) {
  //         totalOutflow += tx.amount;
  //       } else {
  //         totalInflow += tx.amount;
  //       }
  //     });

  //     return {
  //       firstTx: new Date(
  //         transactions[transactions.length - 1].timestamp * 1000,
  //       ),
  //       lastTx: new Date(transactions[0].timestamp * 1000),
  //       txCount: transactions.length,
  //       hasSold: totalOutflow > 0,
  //       netFlow: totalInflow - totalOutflow,
  //     };
  //   } catch (error) {
  //     console.error(`Error analyzing wallet ${walletAddress}:`, error);
  //     return {
  //       firstTx: new Date(),
  //       lastTx: new Date(),
  //       txCount: 0,
  //       hasSold: false,
  //       netFlow: 0,
  //     };
  //   }
  // }
  //
  async analyzeWalletHistory(
    walletAddress: string,
    tokenMint: string,
  ): Promise<{
    firstTx: Date;
    lastTx: Date;
    txCount: number;
    hasSold: boolean;
    netFlow: number;
  }> {
    console.log(
      `Analyzing wallet history for ${walletAddress} on token ${tokenMint}...`,
    );
    try {
      let allTransfers: any[] = [];
      const url = `https://pro-api.solscan.io/v2.0/account/transfer`;
      const headers = {
        token: CONFIG.SOLSCAN_API_KEY,
        "Content-Type": "application/json",
      };
      let currentPage = 1;
      let hasMore = true;
      const pageSize = 100;

      while (hasMore && allTransfers.length < 1000) {
        const params: any = {
          address: walletAddress, // Fixed: was 'walletAddress', should be 'address'
          // Remove token parameter as it might not be supported
          // token: tokenMint,
          page: currentPage,
          page_size: pageSize,
          activity_type: ["ACTIVITY_SPL_TRANSFER"],
          exclude_amount_zero: true,
          sort_by: "block_time",
          sort_order: "desc",
        };

        const response = await axios.get(url, { headers, params });

        if (!response.data.success) {
          console.error("SOLSCAN API returned error:", response.data);
          break;
        }

        const transfers = response.data.data || [];

        if (transfers.length === 0) {
          hasMore = false;
          break;
        }

        // Filter by token mint after fetching (since API might not support direct token filtering)
        const tokenTransfers = transfers.filter(
          (tx: any) => tx.token_address === tokenMint,
        );

        allTransfers = allTransfers.concat(tokenTransfers);
        currentPage++;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      if (allTransfers.length === 0) {
        return {
          firstTx: new Date(),
          lastTx: new Date(),
          txCount: 0,
          hasSold: false,
          netFlow: 0,
        };
      }

      // Sort ascending by block_time to get true first/last
      allTransfers.sort((a, b) => a.block_time - b.block_time);

      let totalInflow = 0;
      let totalOutflow = 0;
      let hasSold = false;

      allTransfers.forEach((tx: any) => {
        if (tx.flow === "out") {
          totalOutflow += tx.amount;
          hasSold = true;
        } else if (tx.flow === "in") {
          totalInflow += tx.amount;
        }
      });

      return {
        firstTx: new Date(allTransfers[0].block_time * 1000),
        lastTx: new Date(
          allTransfers[allTransfers.length - 1].block_time * 1000,
        ),
        txCount: allTransfers.length,
        hasSold,
        netFlow: totalInflow - totalOutflow,
      };
    } catch (error) {
      console.error(`Error analyzing wallet ${walletAddress}:`, error);
      return {
        firstTx: new Date(),
        lastTx: new Date(),
        txCount: 0,
        hasSold: false,
        netFlow: 0,
      };
    }
  }

  getSupplyPct(balanceRaw: bigint, supplyRaw: bigint): number {
    return Number((balanceRaw * 10000n) / supplyRaw) / 100; // two decimals
  }

  async classifyWallet(
    address: string,
    balance: number,
    balanceRaw: bigint,
    supplyRaw: bigint,
    history: WalletHistorySummary,
  ): Promise<WalletCategory> {
    // Check Solscan Metadata labels
    const solscanLabel = await this.getAccountLabel(address);
    if (solscanLabel) {
      const label = solscanLabel.toLowerCase();
      if (
        label.includes("exchange") ||
        label.includes("binance") ||
        label.includes("coinbase") ||
        label.includes("ftx") ||
        label.includes("kraken") ||
        label.includes("okx")
      ) {
        return WalletCategory.Exchange;
      }
    }

    // Pattern-based classification
    // Supply percentage
    const pct = this.getSupplyPct(balanceRaw, supplyRaw);

    // foundation: > 5 % of supply and never sold
    if (pct >= 5 && !history.hasSold) return WalletCategory.Foundation;

    // investor: 1–5 % supply, limited tx, older than 6 mo
    const ageDays =
      (Date.now() - history.firstTx.getTime()) / (1000 * 60 * 60 * 24);

    if (pct >= 1 && pct < 5 && history.txCount < 20 && ageDays > 180) {
      return WalletCategory.Investor;
    }

    // team wallets: 0.1–1 % + vesting-like behaviour
    if (pct >= 0.1 && pct < 1 && !history.hasSold && history.txCount < 50) {
      return WalletCategory.Team;
    }

    // exchanges (behaviour based)
    if (history.txCount > 1_000 || Math.abs(history.netFlow) > 10_000_000) {
      return WalletCategory.Exchange;
    }
    // default
    return WalletCategory.Community;
  }
}
