import { getMint, Mint, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import axios from "axios";
import { AccountTypeClassifier } from "./walletClassifier";
import { Connection, PublicKey, ParsedAccountData } from "@solana/web3.js";
import {
  MintInfo,
  SolscanMetaDataResponse,
  WalletClassification,
  HolderInfo,
  WalletHistorySummary,
  ClassifyWalletContext,
  SolscanAccountData,

} from "../common/interface";
import {
  WalletCategory,
  AccountType,
  DEFAULT_LOCK_LABEL_KEYWORDS,
  EXTRA_TOKEN_PROGRAM_IDS,
  FrozenAccountEntry,
  LabeledOwnerEntry,
  LockBreakdown
} from "../common/constants";
import { CONFIG } from "../config/config";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export type GenerateOptions = {
  outPath?: string;
  includeFullSplit?: boolean;
};

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
    const { value } = await this.connection.getTokenLargestAccounts(mintKey);

    // Filter out zero balances
    const nonEmpty = value.filter((e) => BigInt(e.amount) > 0n);
    if (nonEmpty.length === 0) return null;

    // Enrich each token account with its owner wallet
    const holders: HolderInfo[] = await Promise.all(
      nonEmpty.map(async (entry) => {
        const tokenAccountAddress = entry.address.toBase58();

        const walletAddress = await this.getTokenAccountOwner(tokenAccountAddress);

        const raw = BigInt(entry.amount);
        return {
          tokenAccount: tokenAccountAddress,
          walletAddress, 
          rawBalance: raw,
          balance: Number(raw) / 10 ** entry.decimals,
          decimals: entry.decimals,
        };
      }),
    );

    return holders;
  }

  async getTokenAccountOwner(tokenAccount: string): Promise<string> {
    try {
      const info = await this.connection.getParsedAccountInfo(
        new PublicKey(tokenAccount),
      );
      const parsed: any = info.value?.data as any;

      const isSplTokenAccount =
        parsed &&
        parsed.program === "spl-token" &&
        parsed.parsed?.type === "account" &&
        parsed.parsed?.info?.owner;

      if (isSplTokenAccount) {
        return parsed.parsed.info.owner; // Return the owner wallet address
      }

      // If it's not a token account, assume it's already a wallet address
      return tokenAccount;
    } catch (error) {
      console.warn(`Failed to get token account owner for ${tokenAccount}:`, error);
      // Return the original address if parsing fails
      return tokenAccount;
    }
  }

  async getAccountMetadata(address: string): Promise<SolscanAccountData | null> {
    try {
      const { data } = await axios.get<SolscanMetaDataResponse>(
        "https://pro-api.solscan.io/v2.0/account/metadata",
        {
          params: { address },
          headers: { token: CONFIG.SOLSCAN_API_KEY },
        },
      );

      // Return the full data object when successful
      return data.success && data.data ? data.data : null;
    } catch (err) {
      return null;
    }
  }

  // Keep the original method for backward compatibility
  async getAccountLabel(address: string): Promise<string | null> {
    const metadata = await this.getAccountMetadata(address);
    return metadata?.account_label || null;
  }

  /** Analyse the 20 largest on-chain holders (non-empty accounts) and
   *  return an enriched, typed classification list. */
  async classifyTokenHolders(
    tokenMint: string,
  ): Promise<WalletClassification[]> {
    const DAY_MS = 24 * 60 * 60 * 1000;

    try {
      // Get mint info
      const mintInfo = await this.getMintInfo(
        typeof tokenMint === "string" ? new PublicKey(tokenMint) : tokenMint,
      );
      const supplyRaw = mintInfo.raw.supply;

      console.log(
        `Token Mint: ${mintInfo.address}, Supply: ${mintInfo.supply}, Decimals: ${mintInfo.decimals}`,
      );

      // Get top holders
      console.log("Fetching top token holders...");
      const holders = await this.getTopHolders(tokenMint);

      if (!holders || holders.length === 0) {
        console.error("Error: Failed to fetch top token holders or no holders found.");
        return [];
      }

      console.log(`Found ${holders.length} token holders to classify`);
      const classifications: WalletClassification[] = [];

      // Process each holder
      for (const [index, holder] of holders.entries()) {
        try {
          console.log(`Processing holder ${index + 1}/${holders.length}...`);

          // 1. Resolve wallet address from token account if needed
          const walletAddress = holder.walletAddress ||
            await this.getTokenAccountOwner(holder.tokenAccount);

          // 2. Analyze wallet transaction history
          const history: WalletHistorySummary = await this.analyzeWalletHistory(
            walletAddress,
            tokenMint,
          );

          console.log(`Wallet ${walletAddress}: ${history.txCount} transactions, hasSold: ${history.hasSold}`);
          const ownerMetadata = await this.getAccountMetadata(walletAddress);

          if (ownerMetadata?.account_label || ownerMetadata?.account_tags?.length) {
            console.log(
              `Metadata found - Label: ${ownerMetadata.account_label}, Tags: ${ownerMetadata.account_tags?.join(', ')}`
            );
          }
          const classification = AccountTypeClassifier.classifyAccount(ownerMetadata ?? null);

          console.log(
            `Account classification: ${classification.type} (${classification.confidence} confidence)`
          );

          // 5. Classify wallet category based on behavior + labels
          const category = await this.classifyWallet(
            walletAddress,
            holder.balance,
            holder.rawBalance,
            supplyRaw,
            history,
            {
              accountType: classification.type,
              accountSubType: classification.subType,
              classificationConfidence: classification.confidence,
              isDex: classification.type === AccountType.DEX,
              isCex: classification.type === AccountType.CEX,
            }
          );

          // 6. Calculate diamond hand and long-term flags
          const ageDays = (Date.now() - history.firstTx.getTime()) / DAY_MS;
          const isDiamondHand = !history.hasSold && ageDays >= 90;
          const isLongTermNoOutflow180 =
            ageDays >= 180 &&
            (!history.lastOutflowAt ||
              Date.now() - history.lastOutflowAt.getTime() >= 180 * DAY_MS);

          // 7. Build classification result
          const walletClassification: WalletClassification = {
            address: walletAddress,
            category,
            balance: holder.balance,
            firstTransactionDate: history.firstTx,
            lastTransactionDate: history.lastTx,
            transactionCount: history.txCount,
            hasSold: history.hasSold,
            isDiamondHand,
            isLongTermNoOutflow180,
            metadata: {
              // Basic identification
              label: ownerMetadata?.account_label,
              owner: walletAddress,
              tokenAccount: holder.tokenAccount,
              source: "automated_classification",

              // Enhanced classification data
              accountType: classification.type,
              accountSubType: classification.subType,
              classificationConfidence: classification.confidence,
              classificationReasoning: classification.reasoning,

              // Solscan metadata
              accountTags: ownerMetadata?.account_tags || [],
              activeAgeDays: ownerMetadata?.active_age,
              fundedBy: ownerMetadata?.funded_by ? {
                address: ownerMetadata.funded_by.funded_by,
                txHash: ownerMetadata.funded_by.tx_hash,
                fundedAt: new Date(ownerMetadata.funded_by.block_time * 1000),
              } : undefined,

              // Legacy fields for backward compatibility
              isDex: classification.type === AccountType.DEX,
              isCex: classification.type === AccountType.CEX,
            },
          };

          classifications.push(walletClassification);

          console.log(
            `Classified ${walletAddress} as ${category} (${classification.type})`
          );

        } catch (error) {
          console.error(
            `Error processing holder ${holder.tokenAccount}:`,
            error
          );
          // Continue processing other holders
          continue;
        }

        // Rate limiting to avoid API throttling
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      console.log(`Successfully classified ${classifications.length}/${holders.length} token holders`);

      // Log summary statistics
      const categoryCounts = classifications.reduce((acc, classification) => {
        acc[classification.category] = (acc[classification.category] || 0) + 1;
        return acc;
      }, {} as Record<WalletCategory, number>);

      console.log("Classification summary:", categoryCounts);

      return classifications;

    } catch (error) {
      console.error("Error in classifyTokenHolders:", error);
      throw error;
    }
  }



  async analyzeWalletHistory(
    walletAddress: string,
    tokenMint: string,
  ): Promise<{
    firstTx: Date;
    lastTx: Date;
    txCount: number;
    hasSold: boolean;
    netFlow: number;
    lastOutflowAt: Date | null;
  }> {
    try {
      const url = "https://pro-api.solscan.io/v2.0/account/transfer";
      const headers = {
        token: CONFIG.SOLSCAN_API_KEY,
        "Content-Type": "application/json",
      };

      let ownerAddress = walletAddress;
      const activityTypes = [
        "ACTIVITY_SPL_TRANSFER",
        "ACTIVITY_SPL_MINT",
        "ACTIVITY_SPL_CREATE_ACCOUNT",
        "ACTIVITY_SPL_BURN",
      ];

      const pageSize = 100;
      let page = 1;
      const allTransfers: any[] = [];

      while (allTransfers.length < 1000) {
        const params: any = {
          address: ownerAddress, // OWNER-level aggregation
          token: tokenMint, 
          activity_type: activityTypes,
          exclude_amount_zero: true,
          sort_by: "block_time",
          sort_order: "desc",
          page,
          page_size: pageSize,
        };

      
        const { data } = await axios.get(url, { headers, params });
        if (!data?.success) break;

        const items: any[] = data.data ?? [];
        if (items.length === 0) break;

        allTransfers.push(...items);

        if (items.length < pageSize) break;
        page += 1;

        await new Promise((r) => setTimeout(r, 200));
      }

      if (allTransfers.length === 0) {
        return {
          firstTx: new Date(),
          lastTx: new Date(),
          txCount: 0,
          hasSold: false,
          netFlow: 0,
          lastOutflowAt: null,
        };
      }

      // sort ascending to compute first/last accurately
      allTransfers.sort((a, b) => a.block_time - b.block_time);

      let inflow = 0;
      let outflow = 0;
      let lastOutflowAt: Date | null = null;

      for (const tx of allTransfers) {
        const dec = Number(tx.token_decimals ?? 0);
        const amtUi = Number(tx.amount) / Math.pow(10, dec);

        if (tx.flow === "out") {
          outflow += amtUi;
          const t = new Date(tx.block_time * 1000);
          if (!lastOutflowAt || t.getTime() > lastOutflowAt.getTime()) {
            lastOutflowAt = t;
          }
        } else if (tx.flow === "in") {
          inflow += amtUi;
        }
      }

      return {
        firstTx: new Date(allTransfers[0].block_time * 1000),
        lastTx: new Date(
          allTransfers[allTransfers.length - 1].block_time * 1000,
        ),
        txCount: allTransfers.length,
        hasSold: outflow > 0,
        netFlow: inflow - outflow,
        lastOutflowAt,
      };
    } catch (error) {
      console.error(`Error analyzing wallet ${walletAddress}:`, error);
      return {
        firstTx: new Date(),
        lastTx: new Date(),
        txCount: 0,
        hasSold: false,
        netFlow: 0,
        lastOutflowAt: null,
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
    ctx: ClassifyWalletContext = {},
  ): Promise<WalletCategory> {

    // 1) HIGH-CONFIDENCE LABEL-BASED CLASSIFICATION FIRST
    // These override behavioral patterns when we're confident
    if (ctx.classificationConfidence === 'high' && ctx.accountType) {
      switch (ctx.accountType) {
        case AccountType.CEX:
          return WalletCategory.Exchange;

        case AccountType.DEX:
          return WalletCategory.Dex;

        case AccountType.BRIDGE:
        case AccountType.STAKING:
        case AccountType.PROGRAM_AUTHORITY:
        case AccountType.VALIDATOR:
          return WalletCategory.Infrastructure;

        case AccountType.MARKET_MAKER:
          return WalletCategory.MarketMaker;

        // For other types (DEFI_PROTOCOL, NFT_MARKETPLACE), fall through to behavioral analysis
      }
    }

    // 2) LEGACY SUPPORT (remove once fully migrated)
    if (ctx.isCex) return WalletCategory.Exchange;
    if (ctx.isDex) return WalletCategory.Dex;

    // 3) BEHAVIORAL ANALYSIS FOR UNLABELED OR MEDIUM/LOW CONFIDENCE ACCOUNTS

    const pct = this.getSupplyPct(balanceRaw, supplyRaw);
    const ageDays = (Date.now() - history.firstTx.getTime()) / (1000 * 60 * 60 * 24);

    // Foundation: Large holder that never sold (likely project treasury)
    if (pct >= 5 && !history.hasSold) {
      return WalletCategory.Foundation;
    }

    // Investor: Medium holder with limited activity and age
    if (pct >= 1 && pct < 5 && history.txCount < 20 && ageDays > 180) {
      return WalletCategory.Investor;
    }

    // Team: Small-medium holder with vesting-like behavior
    if (pct >= 0.1 && pct < 1 && !history.hasSold && history.txCount < 50) {
      return WalletCategory.Team;
    }

    // Exchange (behavioral): High activity or large flow
    // This catches unlabeled exchanges or exchange-like behavior
    if (history.txCount > 1_000 || Math.abs(history.netFlow) > 10_000_000) {
      return WalletCategory.Exchange;
    }

    // Market Maker (behavioral): Medium-high activity with balanced flow
    // Detect potential MM behavior even without labels
    if (history.txCount > 100 &&
      Math.abs(history.netFlow) < balance * 0.1 && // Low net flow relative to balance
      ageDays > 30) {
      return WalletCategory.MarketMaker;
    }

    // 4) MEDIUM CONFIDENCE LABELS AS TIEBREAKERS
    // If behavioral analysis doesn't catch anything, use medium confidence labels
    if (ctx.classificationConfidence === 'medium' && ctx.accountType) {
      switch (ctx.accountType) {
        case AccountType.WHALE:
          // Large balance whale -> likely investor
          return pct >= 0.5 ? WalletCategory.Investor : WalletCategory.Community;

        case AccountType.INSTITUTIONAL:
          return WalletCategory.MarketMaker;

        case AccountType.BOT_TRADER:
          return WalletCategory.MarketMaker;
      }
    }

    // Default: Regular community member
    return WalletCategory.Community;
  }

  /** Lower-bound CEX/DEX split using only the top holders you already classify */
  async getSupplySplitTop20(tokenMint: string): Promise<{
    basis: "top20";
    totalSupply: number;
    cex: number;
    dex: number;
    onchainNonCexDex: number;
    unknownRemainder: number;
    cexPctOfTotal: number;
    dexPctOfTotal: number;
    onchainNonCexDexPctOfTotal: number;
    unknownPctOfTotal: number;
    breakdownByExchange: Record<string, number>;
    dexName?: string;
  }> {
    const mintKey = typeof tokenMint === "string" ? new PublicKey(tokenMint) : tokenMint;
    const mintInfo = await this.getMintInfo(mintKey);

    console.log("Getting token holder classifications...");
    const classifications = await this.classifyTokenHolders(tokenMint);

    let cex = 0;
    let dex = 0;
    let onchain = 0;

    const breakdownCex: Record<string, number> = {};
    let primaryDexName: string | undefined;
    let largestDexBalance = 0;

    console.log(`Processing ${classifications.length} classified holders`);

    for (const classification of classifications) {
      const { balance, category, metadata } = classification;

      const accountType = metadata?.accountType;
      const label = metadata?.label?.toLowerCase();
      const subType = metadata?.accountSubType;
      const confidence = metadata?.classificationConfidence;

      switch (accountType) {
        case AccountType.CEX:
          cex += balance;
          const cexKey = label || subType || "exchange (unknown)";
          const cexKeyWithConfidence = confidence !== 'high' ? `${cexKey} [${confidence}]` : cexKey;
          breakdownCex[cexKeyWithConfidence] = (breakdownCex[cexKeyWithConfidence] || 0) + balance;
          break;

        case AccountType.DEX:
          dex += balance;
          if (balance > largestDexBalance) {
            largestDexBalance = balance;
            primaryDexName = label || subType || "dex (unknown)";
          }
          break;
        case AccountType.BRIDGE:
        case AccountType.STAKING:
        case AccountType.VALIDATOR:
        case AccountType.PROGRAM_AUTHORITY:
        case AccountType.UNKNOWN:
          if (category === WalletCategory.Exchange) {
            cex += balance;
            breakdownCex["exchange (behavioral)"] = (breakdownCex["exchange (behavioral)"] || 0) + balance;
          } else if (category === WalletCategory.Dex) {
            dex += balance;
            if (balance > largestDexBalance) {
              largestDexBalance = balance;
              primaryDexName = "dex (behavioral)";
            }
          } else {
            onchain += balance;
          }
          break;

        default:
          onchain += balance;
          break;
      }
    }

    const covered = cex + dex + onchain;
    const unknownRemainder = Math.max(mintInfo.supply - covered, 0);

    console.log(`Supply split summary:
    CEX: ${(cex / mintInfo.supply * 100).toFixed(2)}%
    DEX: ${(dex / mintInfo.supply * 100).toFixed(2)}%
    On-chain: ${(onchain / mintInfo.supply * 100).toFixed(2)}%
    Unknown: ${(unknownRemainder / mintInfo.supply * 100).toFixed(2)}%
  `);

    return {
      basis: "top20",
      totalSupply: mintInfo.supply,
      cex,
      dex,
      onchainNonCexDex: onchain,
      unknownRemainder,
      cexPctOfTotal: (cex / mintInfo.supply) * 100,
      dexPctOfTotal: (dex / mintInfo.supply) * 100,
      onchainNonCexDexPctOfTotal: (onchain / mintInfo.supply) * 100,
      unknownPctOfTotal: (unknownRemainder / mintInfo.supply) * 100,
      breakdownByExchange: breakdownCex,
      dexName: primaryDexName,
    };
  }

  /** Get parsed token accounts for a mint across one or more token programs.
 * Uses TOKEN_PROGRAM_ID plus any extra program IDs provided in CONFIG.EXTRA_TOKEN_PROGRAM_IDS
 */
private async getParsedTokenAccountsForMint(mintKey: PublicKey) {
  const programIds: PublicKey[] = [
    TOKEN_PROGRAM_ID,
    ...(EXTRA_TOKEN_PROGRAM_IDS?.map((s: string) => new PublicKey(s)) || []),
  ];

  const results: Array<{
    programId: PublicKey;
    accountPubkey: PublicKey;
    data: ParsedAccountData;
  }> = [];

  for (const pid of programIds) {
    const accounts = await this.connection.getParsedProgramAccounts(pid, {
      filters: [
        { dataSize: 165 },
        { memcmp: { offset: 0, bytes: mintKey.toBase58() } },
      ],
    });

    for (const a of accounts) {
      results.push({
        programId: pid,
        accountPubkey: a.pubkey,
        data: a.account.data as ParsedAccountData,
      });
    }
  }
  return results;
}

/** Sum balances of token accounts whose parsed.state is Frozen (case-insensitive). */
private async getFrozenSupplyAndAccounts(mintKey: PublicKey): Promise<{
  totalFrozen: number;
  entries: FrozenAccountEntry[];
  perOwnerFrozenMap: Map<string, number>;
}> {
  const accounts = await this.getParsedTokenAccountsForMint(mintKey);

  let totalFrozen = 0;
  const entries: FrozenAccountEntry[] = [];
  const perOwnerFrozenMap = new Map<string, number>();

  for (const { accountPubkey, data } of accounts) {
    const info: any = data.parsed?.info;
    if (!info) continue;

    const state: string = (info.state || info.accountState || "").toString().toLowerCase();
    if (state !== "frozen") continue;

    const owner: string = info.owner;
    const amountStr: string = info.tokenAmount?.amount ?? "0";
    const decimals: number = info.tokenAmount?.decimals ?? 0;
    const raw = BigInt(amountStr);
    const ui = Number(raw) / Math.pow(10, decimals);
    if (ui <= 0) continue;

    totalFrozen += ui;
    entries.push({
      tokenAccount: accountPubkey.toBase58(),
      owner,
      balance: ui,
      raw,
      decimals,
    });
    perOwnerFrozenMap.set(owner, (perOwnerFrozenMap.get(owner) || 0) + ui);
  }

  return { totalFrozen, entries, perOwnerFrozenMap };
}

/** Heuristic: treat owners whose Solscan label/tags include vesting/lock keywords as locked.
 * To avoid double-counting, we later subtract any portion already counted as "frozen".
 */
private async estimateLockedByLabelsExcludingFrozen(
  mintKey: PublicKey,
  perOwnerFrozenMap: Map<string, number>,
  totalSupply: number
): Promise<{
  labeledOwners: LabeledOwnerEntry[];
  labeledTotalEffective: number; // sum of effectiveLocked (excludes frozen already counted)
}> {
  const accounts = await this.getParsedTokenAccountsForMint(mintKey);

  // Aggregate balances per owner (UI)
  const perOwner = new Map<string, number>();
  for (const { data } of accounts) {
    const info: any = data.parsed?.info;
    if (!info) continue;
    const owner: string = info.owner;
    const amountStr: string = info.tokenAmount?.amount ?? "0";
    const decimals: number = info.tokenAmount?.decimals ?? 0;
    const ui = Number(BigInt(amountStr)) / Math.pow(10, decimals);
    if (ui <= 0) continue;
    perOwner.set(owner, (perOwner.get(owner) || 0) + ui);
  }

  // Only fetch metadata for material holders to limit API calls
  const MIN_BALANCE_FOR_CHECK = totalSupply * 0.0001; // 1 bps of supply
  const holdersSorted = Array.from(perOwner.entries()).sort((a, b) => b[1] - a[1]);

  const keywords = (DEFAULT_LOCK_LABEL_KEYWORDS && DEFAULT_LOCK_LABEL_KEYWORDS.length > 0)
    ? DEFAULT_LOCK_LABEL_KEYWORDS.map((k: string) => k.toLowerCase())
    : DEFAULT_LOCK_LABEL_KEYWORDS;

  const labeledOwners: LabeledOwnerEntry[] = [];
  let labeledTotalEffective = 0;

  let checks = 0;
  const MAX_CHECKS = 300;
  const BATCH = 10;
  let batchCount = 0;

  for (const [owner, balance] of holdersSorted) {
    if (checks >= MAX_CHECKS) break;
    if (balance < MIN_BALANCE_FOR_CHECK) break;

    let metadata: any = null;
    try {
      metadata = await this.getAccountMetadata(owner);
      checks++;
      if (++batchCount % BATCH === 0) {
        await new Promise((r) => setTimeout(r, 200));
      }
    } catch (_) {
      metadata = null;
    }

    const label = metadata?.account_label?.toLowerCase?.() || null;
    const tags: string[] = (metadata?.account_tags || []).map((t: string) => t.toLowerCase());
    const haystack = [label || "", ...tags].join(" ");

    let matched = "";
    for (const kw of keywords) {
      if (kw && haystack.includes(kw)) {
        matched = kw;
        break;
      }
    }
    if (!matched) continue;

    const frozenPortion = perOwnerFrozenMap.get(owner) || 0;
    const effectiveLocked = Math.max(0, balance - frozenPortion); // avoid double-counting

    labeledOwners.push({
      owner,
      label: metadata?.account_label || null,
      tags: metadata?.account_tags || [],
      balance,
      frozenPortion,
      effectiveLocked,
      matchedBy: matched,
    });

    labeledTotalEffective += effectiveLocked;
  }

  return { labeledOwners, labeledTotalEffective };
}

/** High-level lock breakdown: Frozen + (heuristic) LabeledVesting; Circulating = Total - Locked */
public async getLockBreakdown(tokenMint: string): Promise<LockBreakdown> {
  const mintKey = typeof tokenMint === "string" ? new PublicKey(tokenMint) : tokenMint;
  const mintInfo = await this.getMintInfo(mintKey);

  // A) on-chain enforced locks (Frozen)
  const { totalFrozen, entries: frozenEntries, perOwnerFrozenMap } =
    await this.getFrozenSupplyAndAccounts(mintKey);

  // B) heuristic vesting/escrow via labels/tags; exclude frozen portion
  const { labeledOwners, labeledTotalEffective } =
    await this.estimateLockedByLabelsExcludingFrozen(mintKey, perOwnerFrozenMap, mintInfo.supply);

  const lockedTotal = totalFrozen + labeledTotalEffective;
  const circulating = Math.max(0, mintInfo.supply - lockedTotal);

  const notes = [
    "Frozen = token accounts with state=frozen (on-chain enforced).",
    "LabeledVesting = owners whose Solscan label/tags match vesting/lock keywords; frozen portion excluded to prevent double-count.",
    "This heuristic will miss bespoke vesting contracts unless their owners are labeled (configure CONFIG.LOCK_LABEL_KEYWORDS or add program-specific parsers).",
  ];

  return {
    totalSupply: mintInfo.supply,
    lockedTotal,
    circulating,
    components: {
      frozen: totalFrozen,
      labeledVesting: labeledTotalEffective,
    },
    details: {
      frozenAccounts: frozenEntries.sort((a, b) => b.balance - a.balance),
      labeledOwners: labeledOwners.sort((a, b) => b.effectiveLocked - a.effectiveLocked),
    },
    notes,
  };
}


  async getSupplySplitFull(tokenMint: string): Promise<{
    basis: "full";
    totalSupply: number;
    cex: number;
    dex: number;
    onchainNonCexDex: number;
    cexPctOfTotal: number;
    dexPctOfTotal: number;
    onchainNonCexDexPctOfTotal: number;
    breakdownByExchange: Record<string, number>;
    dexName?: string;
  }> {
    const mintKey = typeof tokenMint === "string" ? new PublicKey(tokenMint) : tokenMint;
    const mintInfo = await this.getMintInfo(mintKey);

    const accounts = await this.connection.getParsedProgramAccounts(
      TOKEN_PROGRAM_ID,
      {
        filters: [
          { dataSize: 165 },
          { memcmp: { offset: 0, bytes: mintKey.toBase58() } },
        ],
      },
    );

    console.log(`Found ${accounts.length} token accounts for mint ${tokenMint}`);

    const perOwner = new Map<string, number>();
    for (const acc of accounts) {
      const data = acc.account.data as ParsedAccountData;
      const info: any = data.parsed?.info;
      if (!info) continue;

      const owner: string = info.owner;
      const amountStr: string = info.tokenAmount?.amount ?? "0";
      const decimals: number = info.tokenAmount?.decimals ?? 0;
      const ui = Number(BigInt(amountStr)) / Math.pow(10, decimals);
      if (ui <= 0) continue;

      perOwner.set(owner, (perOwner.get(owner) || 0) + ui);
    }

    const ownersSorted = Array.from(perOwner.entries()).sort(
      (a, b) => b[1] - a[1],
    );

    console.log(`Processing ${ownersSorted.length} unique owners`);

    let cex = 0;
    let dex = 0;
    let onchain = 0;

    const breakdownCex: Record<string, number> = {};
    let primaryDexName: string | undefined;
    let largestDexBalance = 0;

    const metadataCache = new Map<string, SolscanAccountData | null>();
    const MAX_METADATA_CHECKS = 300;
    const MIN_BALANCE_FOR_CHECK = mintInfo.supply * 0.0001;
    const BATCH_SIZE = 10;

    let metadataChecks = 0;
    let batchCount = 0;

    for (const [owner, balance] of ownersSorted) {
      let ownerMetadata: SolscanAccountData | null = null;

      const shouldCheckMetadata =
        metadataChecks < MAX_METADATA_CHECKS &&
        balance >= MIN_BALANCE_FOR_CHECK;

      if (shouldCheckMetadata) {
        if (metadataCache.has(owner)) {
          ownerMetadata = metadataCache.get(owner)!;
        } else {
          try {
            ownerMetadata = await this.getAccountMetadata(owner);
            metadataCache.set(owner, ownerMetadata);
            metadataChecks++;

            if (++batchCount % BATCH_SIZE === 0) {
              await new Promise((r) => setTimeout(r, 200));
            }
          } catch (error) {
            console.warn(`Failed to get metadata for ${owner}:`, error);
            metadataCache.set(owner, null);
          }
        }
      }

      const classification = AccountTypeClassifier.classifyAccount(ownerMetadata);

      switch (classification.type) {
        case AccountType.CEX:
          cex += balance;
          const breakdownKey = ownerMetadata?.account_label?.toLowerCase() ||
            classification.subType || "exchange (unknown)";
          const keyWithConfidence = classification.confidence !== 'high' ?
            `${breakdownKey} [${classification.confidence}]` : breakdownKey;
          breakdownCex[keyWithConfidence] = (breakdownCex[keyWithConfidence] || 0) + balance;
          break;

        case AccountType.DEX:
          dex += balance;
          if (balance > largestDexBalance) {
            largestDexBalance = balance;
            primaryDexName = ownerMetadata?.account_label?.toLowerCase() ||
              classification.subType || "dex (unknown)";
          }
          break;

        // REMOVED: All infrastructure cases now go to onchain
        default:
          onchain += balance;
          break;
      }

      if (balance >= mintInfo.supply * 0.01) {
        console.log(
          `Large holder: ${owner.slice(0, 8)}... | ${balance.toLocaleString()} tokens (${(balance / mintInfo.supply * 100).toFixed(2)}%) | ${classification.type} (${classification.confidence})`
        );
      }
    }

    console.log(`Metadata checks performed: ${metadataChecks}/${ownersSorted.length}`);

    const supply = mintInfo.supply;
    return {
      basis: "full",
      totalSupply: supply,
      cex,
      dex,
      onchainNonCexDex: onchain,
      cexPctOfTotal: (cex / supply) * 100,
      dexPctOfTotal: (dex / supply) * 100,
      onchainNonCexDexPctOfTotal: (onchain / supply) * 100,
      breakdownByExchange: breakdownCex,
      dexName: primaryDexName,
    };
  }
 async getSupplyAnalysis(
  tokenMint: string
): Promise<{
  top20: Awaited<ReturnType<SolanaLib["getSupplySplitTop20"]>>;
  full: Awaited<ReturnType<SolanaLib["getSupplySplitFull"]>>;
  summary: {
    totalHolders: number;
    concentrationRisk: 'high' | 'medium' | 'low';
    exchangeExposure: 'high' | 'medium' | 'low';
    decentralizationScore: number; // 0-100
    primaryDex?: string; // NEW: Name of the primary DEX
  };
}> {
  console.log(`Starting comprehensive supply analysis for ${tokenMint}`);

  const [top20, full] = await Promise.all([
    this.getSupplySplitTop20(tokenMint),
    this.getSupplySplitFull(tokenMint)
  ]);

  // Calculate risk metrics
  const cexPct = full.cexPctOfTotal;
  const concentrationRisk =
    cexPct > 50 ? 'high' :
    cexPct > 25 ? 'medium' : 'low';

  const totalExchangePct = full.cexPctOfTotal + full.dexPctOfTotal;
  const exchangeExposure =
    totalExchangePct > 60 ? 'high' :
    totalExchangePct > 30 ? 'medium' : 'low';

  // Updated decentralization score (removed infrastructure calculation)
  const decentralizationScore = Math.max(0, Math.min(100,
    100 - cexPct // Simplified: just based on CEX concentration
  ));

  // Estimate total holders (simplified since we removed infrastructure breakdown)
  const estimatedHolders = Object.keys(full.breakdownByExchange).length + 
    (full.dexName ? 1 : 0) + // Count DEX if present
    50; // Rough estimate for on-chain holders

  return {
    top20,
    full,
    summary: {
      totalHolders: estimatedHolders,
      concentrationRisk,
      exchangeExposure,
      decentralizationScore: Math.round(decentralizationScore),
      primaryDex: full.dexName, // Include the primary DEX name
    }
  };
}

  /** CSV helpers */
  private csvEscape(v: any): string {
    if (v === null || v === undefined) return "";
    const s = String(v);
    // quote if contains comma, quote, newline, or leading/trailing spaces
    if (/[",\n]|^\s|\s$/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  private csvRow(cells: any[]): string {
    return cells.map((c) => this.csvEscape(c)).join(",");
  }

  private fmtDate(d?: Date | null): string {
    if (!d) return "";
    // ISO without ms for clean spreadsheets
    return new Date(d).toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  private async ensureDir(p: string) {
    const dir = path.dirname(p);
    await fs.mkdir(dir, { recursive: true });
  }



  public async generate(
    tokenMint: string,
    opts: GenerateOptions = {},
  ): Promise<string> {
    const mintKey =
      typeof tokenMint === "string" ? new PublicKey(tokenMint) : tokenMint;

    console.log(`Starting report generation for token: ${mintKey.toBase58()}`);

    const mintInfo = await this.getMintInfo(mintKey);
    const holders = (await this.getTopHolders(mintKey)) ?? [];
    const classified = await this.classifyTokenHolders(mintKey.toBase58());
    const splitTop20 = await this.getSupplySplitTop20(mintKey.toBase58());
    const splitFull = opts.includeFullSplit
      ? await this.getSupplySplitFull(mintKey.toBase58())
      : undefined;

    // Map classifications by wallet address (not token account)
    const classByWallet = new Map<string, WalletClassification>();
    for (const c of classified) {
      classByWallet.set(c.address, c);
    }

    const lines: string[] = [];
    lines.push(this.csvRow(["Section", "Key/Column", "Value/…"]));

    // MintInfo Section
    const mintSection: Array<[string, string | number | null]> = [
      ["Mint Address", mintInfo.address],
      ["Total Supply (UI)", mintInfo.supply],
      ["Decimals", mintInfo.decimals],
      ["Mint Authority", mintInfo.mintAuthority],
      ["Freeze Authority", mintInfo.freezeAuthority],
      ["Generated At (UTC)", this.fmtDate(new Date())],
    ];
    for (const [k, v] of mintSection) {
      lines.push(this.csvRow(["MintInfo", k, v]));
    }

    lines.push(this.csvRow(["", "", ""]));

    // SupplySplitTop20 Section
    this.addSupplySplitSection(lines, "SupplySplitTop20", splitTop20);

    // SupplySplitFull Section (if enabled)
    if (splitFull) {
      lines.push(this.csvRow(["", "", ""]));
      this.addSupplySplitSection(lines, "SupplySplitFull", splitFull);
    }

        // --- NEW: Lock / Circulating summary ---
    const lockStats = await this.getLockBreakdown(mintKey.toBase58());

    lines.push(this.csvRow(["", "", ""]));
    lines.push(this.csvRow(["LockSummary", "Total Supply (UI)", lockStats.totalSupply]));
    lines.push(this.csvRow(["LockSummary", "Locked (Total)", lockStats.lockedTotal]));
    lines.push(this.csvRow(["LockSummary", "Circulating (Est.)", lockStats.circulating]));
    lines.push(this.csvRow(["LockSummary", "Frozen (on-chain)", lockStats.components.frozen]));
    lines.push(this.csvRow(["LockSummary", "LabeledVesting (heuristic, excl. frozen)", lockStats.components.labeledVesting]));

    // Details: top frozen token accounts
    const topFrozen = lockStats.details.frozenAccounts.slice(0, 20);
    for (const f of topFrozen) {
      lines.push(this.csvRow([
        "LockSummary:FrozenAccounts",
        f.tokenAccount,
        f.owner,
        f.balance
      ]));
    }

    // Details: top labeled vesting owners
    const topLabeled = lockStats.details.labeledOwners.slice(0, 20);
    for (const l of topLabeled) {
      lines.push(this.csvRow([
        "LockSummary:LabeledOwners",
        l.owner,
        l.label || "",
        `${l.balance}`,                    // total owner balance
        `${l.frozenPortion}`,              // of which frozen
        `${l.effectiveLocked}`,            // counted as "labeled lock"
        l.matchedBy,
        (l.tags || []).join("; ")
      ]));
    }

    // Notes
    for (const n of lockStats.notes) {
      lines.push(this.csvRow(["LockSummary:Notes", "", n]));
    }


    lines.push(this.csvRow(["", "", ""]));

    // Enhanced Holders Section
    lines.push(
      this.csvRow([
        "Section",
        "#",
        "TokenAccount",
        "Owner",
        "Category",
        "AccountType",
        "SubType",
        "Confidence",
        "Balance(UI)",
        "% of Total Supply",
        "TxCount",
        "FirstTx(UTC)",
        "LastTx(UTC)",
        "HasSold",
        "DiamondHand(>=90d & no sell)",
        "NoOutflow180d",
        "Label",
        "Tags",
        "ActiveAgeDays",
        "FundedBy",
        "isDEX",
        "isCEX",
      ]),
    );

    const sortedHolders = [...holders].sort((a, b) => b.balance - a.balance);
    const supplyRaw = mintInfo.raw.supply;

    sortedHolders.forEach((h, idx) => {
      const cls = classByWallet.get(h.walletAddress);
      const pctSupply = this.getSupplyPct(h.rawBalance, supplyRaw);

      lines.push(
        this.csvRow([
          "Holders",
          String(idx + 1),
          h.tokenAccount,
          cls?.metadata?.owner ?? h.walletAddress ?? "",
          cls?.category ?? WalletCategory.Community,
          cls?.metadata?.accountType ?? AccountType.UNKNOWN,
          cls?.metadata?.accountSubType ?? "",
          cls?.metadata?.classificationConfidence ?? "",
          h.balance,
          pctSupply.toFixed(2),
          cls?.transactionCount ?? "",
          this.fmtDate(cls?.firstTransactionDate),
          this.fmtDate(cls?.lastTransactionDate),
          cls?.hasSold ?? "",
          cls?.isDiamondHand ?? "",
          cls?.isLongTermNoOutflow180 ?? "",
          cls?.metadata?.label ?? "",
          cls?.metadata?.accountTags?.join("; ") ?? "",
          cls?.metadata?.activeAgeDays ?? "",
          cls?.metadata?.fundedBy?.address ?? "",
          cls?.metadata?.isDex ?? false,
          cls?.metadata?.isCex ?? false,
        ]),
      );
    });

    // Add Classification Summary Section
    lines.push(this.csvRow(["", "", ""]));
    this.addClassificationSummary(lines, classified, mintInfo.supply);
    lines.push(this.csvRow(["", "", ""]));

    // Generate file
    const ts = new Date().toISOString().replace(/[:.Z]/g, "").slice(0, 15);
    const safeMint = mintInfo.address;
    const outPath =
      opts.outPath ?? path.resolve("./reports", `${safeMint}_${ts}.csv`);

    await this.ensureDir(outPath);
    await fs.writeFile(outPath, lines.join("\n"), "utf8");

    console.log(`\nCSV report written to: ${outPath}`);
    console.log(`Report contains ${classified.length} classified holders`);
    return outPath;
  }

  private addSupplySplitSection(
    lines: string[],
    sectionName: string,
    split: any
  ): void {
    lines.push(this.csvRow([sectionName, "Total Supply (UI)", split.totalSupply]));


    const cexWithPct = `${split.cex} (${split.cexPctOfTotal.toFixed(2)}%)`;
    lines.push(this.csvRow([sectionName, "CEX", cexWithPct]));

    const dexName = split.dexName ? ` - ${split.dexName}` : '';
    const dexWithPct = `${split.dex} (${split.dexPctOfTotal.toFixed(2)}%)${dexName}`;
    lines.push(this.csvRow([sectionName, "DEX", dexWithPct]));

    const onchainWithPct = `${split.onchainNonCexDex} (${split.onchainNonCexDexPctOfTotal.toFixed(2)}%)`;
    lines.push(this.csvRow([sectionName, "On-chain non-CEX/DEX", onchainWithPct]));

    if ('unknownRemainder' in split) {
      const unknownWithPct = `${split.unknownRemainder} (${split.unknownPctOfTotal.toFixed(2)}%)`;
      lines.push(this.csvRow([sectionName, "Unknown Remainder", unknownWithPct]));
    }

    for (const [name, amt] of Object.entries(split.breakdownByExchange as Record<string, number>).sort((a, b) => b[1] - a[1])) {
      const pct = ((amt / split.totalSupply) * 100).toFixed(2);
      lines.push(this.csvRow([`${sectionName}:BreakdownCEX`, name, `${amt} (${pct}%)`]));
    }

  }

  private addClassificationSummary(
    lines: string[],
    classifications: WalletClassification[],
    totalSupply: number
  ): void {
    lines.push(this.csvRow(["ClassificationSummary", "Metric", "Count", "Total Balance", "% of Supply"]));


    const categoryStats = new Map<WalletCategory, { count: number; balance: number }>();

    for (const c of classifications) {
      const current = categoryStats.get(c.category) || { count: 0, balance: 0 };
      categoryStats.set(c.category, {
        count: current.count + 1,
        balance: current.balance + c.balance
      });
    }

    for (const [category, stats] of categoryStats.entries()) {
      const pct = (stats.balance / totalSupply * 100).toFixed(2);
      lines.push(this.csvRow([
        "ClassificationSummary",
        `Category: ${category}`,
        stats.count,
        stats.balance.toFixed(6),
        pct
      ]));
    }

    lines.push(this.csvRow(["", "", "", "", ""]));

    const typeStats = new Map<AccountType, { count: number; balance: number }>();

    for (const c of classifications) {
      const accountType = c.metadata?.accountType || AccountType.UNKNOWN;
      const current = typeStats.get(accountType) || { count: 0, balance: 0 };
      typeStats.set(accountType, {
        count: current.count + 1,
        balance: current.balance + c.balance
      });
    }

    for (const [type, stats] of typeStats.entries()) {
      const pct = (stats.balance / totalSupply * 100).toFixed(2);
      lines.push(this.csvRow([
        "ClassificationSummary",
        `AccountType: ${type}`,
        stats.count,
        stats.balance.toFixed(6),
        pct
      ]));
    }
  }

}
