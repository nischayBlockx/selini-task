import { Mint } from "@solana/spl-token";
import { WalletCategory } from "./constants";

export interface WalletClassification {
  address: string;
  category: WalletCategory;
  balance: number;
  firstTransactionDate: Date;
  lastTransactionDate: Date;
  transactionCount: number;
  hasSold: boolean;
  isDiamondHand: boolean;
  isLongTermNoOutflow180?: boolean;
  metadata?: {
    label?: string;
    source: "automated_classification";
  };
}

export interface WalletHistorySummary {
  firstTx: Date;
  lastTx: Date;
  txCount: number;
  hasSold: boolean;
  netFlow: number; // +ve = net in, -ve = net out
  lastOutflowAt: Date | null;
}

export interface HolderInfo {
  address: string;
  balance: number;
  rawBalance: bigint;
  decimals: number;
}

export interface TokenHolder {
  address: string;
  balance: number;
  rank: number;
  percentage: number;
}

export interface MintInfo {
  address: string;
  supply: number;
  decimals: number;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  raw: Mint;
}

export interface SolscanMetaDataResponse {
  success: boolean;
  data?: {
    account_label?: string;
  };
}
