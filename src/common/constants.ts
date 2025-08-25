export enum WalletCategory {
  Exchange = "exchange",
  Foundation = "foundation", 
  Investor = "investor",
  Team = "team",
  Community = "community",
  Dex = "dex",
  Infrastructure = "infrastructure",
  MarketMaker = "market_maker",
}

export const CEX_KEYWORDS = [
  "binance",
  "coinbase",
  "kraken",
  "okx",
  "bybit",
  "bitfinex",
  "kucoin",
  "mexc",
  "gate.io",
  "gate io",
  "huobi",
  "upbit",
  "ftx",
  "bitstamp",
  "bitget",
  "crypto.com",
  "cryptocom",
  "gemini",
  "poloniex",
  "bittrex",
  "cex.io",
  "bitvavo",
];

// Decentralized exchanges / AMMs / Pools (DEX) — on-chain venues
export const DEX_KEYWORDS = [
  "meteora",
  "dlmm",
  "clmm",
  "whirlpool",
  "pool",
  "liquidity pool",
  "liquidity provider",
  "lp",
  "amm",
  "raydium",
  "orca",
  "openbook",
  "serum",
  "phoenix",
  "kamino",
  "lifinity",
  "crema",
  "saros",
  "saber",
  "cykura",
  "jupiter", // aggregator; many pool labels still show underlying AMM
  "drift",
  "mango",
  "zeta", // perps/margin DEXs (may hold custodied assets on-chain)
  "aldrin",
  "mercurial",
  "marinade",
  "solend",
  "francium",
  "tulip",
  "port finance",
  "larix",
  "apricot",
  "dex",
  "swap",
  "automated market maker",
];

export type FrozenAccountEntry = {
  tokenAccount: string;
  owner: string;
  balance: number;        // UI amount
  raw: bigint;
  decimals: number;
};

export type LabeledOwnerEntry = {
  owner: string;
  label: string | null;
  tags: string[];
  balance: number;        // UI amount (total tokens held by owner)
  frozenPortion: number;  // UI amount owned by this owner that is frozen
  effectiveLocked: number;// balance - frozenPortion (to avoid double count) if considered "label-locked"
  matchedBy: string;      // which keyword matched
};

export type LockBreakdown = {
  totalSupply: number;
  lockedTotal: number;
  circulating: number;
  components: {
    frozen: number;
    labeledVesting: number; // excludes frozen portion to avoid double counting
  };
  details: {
    frozenAccounts: FrozenAccountEntry[];
    labeledOwners: LabeledOwnerEntry[];
  };
  notes: string[];
};

export enum AccountType {
  CEX = 'cex',
  DEX = 'dex', 
  DEFI_PROTOCOL = 'defi_protocol',
  BRIDGE = 'bridge',
  STAKING = 'staking',
  NFT_MARKETPLACE = 'nft_marketplace',
  VALIDATOR = 'validator',
  PROGRAM_AUTHORITY = 'program_authority',
  MARKET_MAKER = 'market_maker',
  WHALE = 'whale',
  BOT_TRADER = 'bot_trader',
  INSTITUTIONAL = 'institutional',
  UNKNOWN = 'unknown'
}

export const DEFAULT_LOCK_LABEL_KEYWORDS = [
  "streamflow",
  "vesting",
  "timelock",
  "lock",
  "escrow",
  "cliff",
  "unlock schedule",
  "vsr",
  "realms",
  "governance lock"
];

export const EXTRA_TOKEN_PROGRAM_IDS = [
  "TokenzQd2R9mAm9TzA3p8QwYQzf6k8iY4pQ8XGZoR9Z" // Token-2022 program id
];
