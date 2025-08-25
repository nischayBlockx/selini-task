import { Mint } from "@solana/spl-token";
import { WalletCategory, AccountType } from "./constants";

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
    owner: string; 
    tokenAccount: string;
    source: "automated_classification";
    accountType: AccountType;
    accountSubType?: string;
    classificationConfidence: 'high' | 'medium' | 'low';
    classificationReasoning?: string[]; 
    accountTags: string[];
    activeAgeDays?: number;
    fundedBy?: {
      address: string;
      txHash: string;
      fundedAt: Date;
    };
    isDex?: boolean;
    isCex?: boolean;
  };
}

export interface ClassifyWalletContext {
  accountType?: AccountType;
  accountSubType?: string;
  classificationConfidence?: 'high' | 'medium' | 'low';
  isDex?: boolean;
  isCex?: boolean;
}

export interface WalletHistorySummary {
  firstTx: Date;
  lastTx: Date;
  txCount: number;
  hasSold: boolean;
  netFlow: number;
  lastOutflowAt: Date | null;
}

export interface HolderInfo {
  tokenAccount: string;
  walletAddress: string;
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
  data?: SolscanAccountData;
}

export interface AccountClassification {
  type: AccountType;
  confidence: 'high' | 'medium' | 'low';
  subType?: string;
  reasoning: string[];
}

export interface SolscanAccountData {
  account_label?: string;
  account_tags?: string[];
  funded_by?: {
    funded_by: string;
    tx_hash: string;
    block_time: number;
  };
  active_age?: number;
}
