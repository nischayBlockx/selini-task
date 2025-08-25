import { SolscanAccountData, AccountClassification } from "../common/interface";
import { AccountType } from "../common/constants";

export class AccountTypeClassifier {
  // Centralized Exchange patterns
  private static readonly CEX_LABELS = [
    'binance', 'coinbase', 'mexc', 'okx', 'bybit', 'kucoin',
    'gate.io', 'huobi', 'htx', 'crypto.com', 'kraken', 'bitfinex',
    'gemini', 'bitstamp', 'upbit', 'bithumb'
  ];

  private static readonly CEX_TAGS = [
    'cex', 'exchange', 'centralized_exchange'
  ];

  // DEX and DeFi patterns
  private static readonly DEX_LABELS = [
    'raydium', 'jupiter', 'orca', 'serum', 'mango', 'drift',
    'phoenix', '1inch', 'uniswap', 'sushiswap', 'meteora', 'meteora dex',
  ];

  private static readonly DEX_TAGS = [
    'dex', 'dex_wallet', 'aggregator', 'amm'
  ];

  private static readonly DEFI_LABELS = [
    'solend', 'kamino', 'marginfi', 'jet', 'francium', 'apricot',
    'port', 'larix', 'tulip', 'quarry', 'sunny', 'saber'
  ];

  private static readonly DEFI_TAGS = [
    'defi', 'lending', 'yield_farming', 'liquidity_provider',
    'protocol', 'vault'
  ];

  // Bridge patterns
  private static readonly BRIDGE_LABELS = [
    'wormhole', 'portal', 'allbridge', 'multichain', 'synapse',
    'hop', 'across', 'stargate'
  ];

  private static readonly BRIDGE_TAGS = [
    'bridge', 'cross_chain', 'interoperability'
  ];

  // Staking patterns
  private static readonly STAKING_LABELS = [
    'marinade', 'lido', 'jito', 'blaze', 'cogent', 'stake_pool'
  ];

  private static readonly STAKING_TAGS = [
    'staking', 'stake_pool', 'validator', 'liquid_staking'
  ];

  // NFT patterns
  private static readonly NFT_LABELS = [
    'magic eden', 'opensea', 'solanart', 'digitaleyes', 'alpha art',
    'solsea', 'hyperspace', 'tensor', 'coral cube'
  ];

  private static readonly NFT_TAGS = [
    'nft', 'marketplace', 'nft_trader', 'collection'
  ];

  // Market maker patterns
  private static readonly MM_LABELS = [
    'market maker', 'mm', 'jump', 'alameda', 'wintermute',
    'galaxy digital', 'hudson river', 'optiver'
  ];

  private static readonly MM_TAGS = [
    'market_maker', 'institutional', 'prop_trading'
  ];

  // Program/Authority patterns
  private static readonly PROGRAM_KEYWORDS = [
    'authority', 'program', 'mint', 'token program', 'system program',
    'metaplex', 'anchor', 'multisig'
  ];

  /**
   * Classifies an account based on its label and tags
   */
  static classifyAccount(data: SolscanAccountData | null): AccountClassification {
    if (!data) {
      return {
        type: AccountType.UNKNOWN,
        confidence: 'high',
        reasoning: ['No account data available']
      };
    }

    const { account_label, account_tags = [] } = data;
    const reasoning: string[] = [];
    
    // Normalize inputs
    const labelLower = account_label?.toLowerCase() || '';
    const tagsLower = account_tags.map(tag => tag.toLowerCase());

    // Check for CEX
    const cexResult = this.checkCEX(labelLower, tagsLower, reasoning);
    if (cexResult) return cexResult;

    // Check for DEX
    const dexResult = this.checkDEX(labelLower, tagsLower, reasoning);
    if (dexResult) return dexResult;

    // Check for Bridge
    const bridgeResult = this.checkBridge(labelLower, tagsLower, reasoning);
    if (bridgeResult) return bridgeResult;

    // Check for Staking
    const stakingResult = this.checkStaking(labelLower, tagsLower, reasoning);
    if (stakingResult) return stakingResult;

    // Check for DeFi Protocol
    const defiResult = this.checkDeFi(labelLower, tagsLower, reasoning);
    if (defiResult) return defiResult;

    // Check for NFT Marketplace
    const nftResult = this.checkNFT(labelLower, tagsLower, reasoning);
    if (nftResult) return nftResult;

    // Check for Market Maker
    const mmResult = this.checkMarketMaker(labelLower, tagsLower, reasoning);
    if (mmResult) return mmResult;

    // Check for Program/Authority
    const programResult = this.checkProgram(labelLower, tagsLower, reasoning);
    if (programResult) return programResult;

    // Check for Validator
    const validatorResult = this.checkValidator(labelLower, tagsLower, reasoning);
    if (validatorResult) return validatorResult;

    // Check for Whale/Bot patterns
    const behaviorResult = this.checkBehaviorPatterns(labelLower, tagsLower, reasoning);
    if (behaviorResult) return behaviorResult;

    // Default to unknown
    return {
      type: AccountType.UNKNOWN,
      confidence: 'high',
      reasoning: account_label || account_tags.length > 0 
        ? ['Labeled entity but type could not be determined']
        : ['No identifying information available']
    };
  }

  

  private static checkCEX(label: string, tags: string[], reasoning: string[]): AccountClassification | null {
    const cexMatches = this.CEX_LABELS.filter(cex => label.includes(cex));
    const cexTagMatches = tags.filter(tag => this.CEX_TAGS.includes(tag));

    if (cexMatches.length > 0 || cexTagMatches.length > 0) {
      if (cexMatches.length > 0) reasoning.push(`Label contains CEX keyword: ${cexMatches[0]}`);
      if (cexTagMatches.length > 0) reasoning.push(`Tagged as: ${cexTagMatches.join(', ')}`);

      return {
        type: AccountType.CEX,
        confidence: 'high',
        subType: cexMatches[0] || cexTagMatches[0],
        reasoning
      };
    }
    return null;
  }

  private static checkDEX(label: string, tags: string[], reasoning: string[]): AccountClassification | null {
    const dexMatches = this.DEX_LABELS.filter(dex => label.includes(dex));
    const dexTagMatches = tags.filter(tag => this.DEX_TAGS.includes(tag));

    if (dexMatches.length > 0 || dexTagMatches.length > 0) {
      if (dexMatches.length > 0) reasoning.push(`Label contains DEX keyword: ${dexMatches[0]}`);
      if (dexTagMatches.length > 0) reasoning.push(`Tagged as: ${dexTagMatches.join(', ')}`);

      return {
        type: AccountType.DEX,
        confidence: 'high',
        subType: dexMatches[0] || dexTagMatches[0],
        reasoning
      };
    }
    return null;
  }

  private static checkBridge(label: string, tags: string[], reasoning: string[]): AccountClassification | null {
    const bridgeMatches = this.BRIDGE_LABELS.filter(bridge => label.includes(bridge));
    const bridgeTagMatches = tags.filter(tag => this.BRIDGE_TAGS.includes(tag));

    if (bridgeMatches.length > 0 || bridgeTagMatches.length > 0) {
      if (bridgeMatches.length > 0) reasoning.push(`Label contains bridge keyword: ${bridgeMatches[0]}`);
      if (bridgeTagMatches.length > 0) reasoning.push(`Tagged as: ${bridgeTagMatches.join(', ')}`);

      return {
        type: AccountType.BRIDGE,
        confidence: 'high',
        subType: bridgeMatches[0] || bridgeTagMatches[0],
        reasoning
      };
    }
    return null;
  }

  private static checkStaking(label: string, tags: string[], reasoning: string[]): AccountClassification | null {
    const stakingMatches = this.STAKING_LABELS.filter(staking => label.includes(staking));
    const stakingTagMatches = tags.filter(tag => this.STAKING_TAGS.includes(tag));
    const hasStakeKeyword = label.includes('stake') || label.includes('validator');

    if (stakingMatches.length > 0 || stakingTagMatches.length > 0 || hasStakeKeyword) {
      if (stakingMatches.length > 0) reasoning.push(`Label contains staking service: ${stakingMatches[0]}`);
      if (stakingTagMatches.length > 0) reasoning.push(`Tagged as: ${stakingTagMatches.join(', ')}`);
      if (hasStakeKeyword && !stakingMatches.length) reasoning.push('Label contains staking keywords');

      return {
        type: AccountType.STAKING,
        confidence: stakingMatches.length > 0 || stakingTagMatches.length > 0 ? 'high' : 'medium',
        subType: stakingMatches[0] || stakingTagMatches[0],
        reasoning
      };
    }
    return null;
  }

  private static checkDeFi(label: string, tags: string[], reasoning: string[]): AccountClassification | null {
    const defiMatches = this.DEFI_LABELS.filter(defi => label.includes(defi));
    const defiTagMatches = tags.filter(tag => this.DEFI_TAGS.includes(tag));

    if (defiMatches.length > 0 || defiTagMatches.length > 0) {
      if (defiMatches.length > 0) reasoning.push(`Label contains DeFi protocol: ${defiMatches[0]}`);
      if (defiTagMatches.length > 0) reasoning.push(`Tagged as: ${defiTagMatches.join(', ')}`);

      return {
        type: AccountType.DEFI_PROTOCOL,
        confidence: 'high',
        subType: defiMatches[0] || defiTagMatches[0],
        reasoning
      };
    }
    return null;
  }

  private static checkNFT(label: string, tags: string[], reasoning: string[]): AccountClassification | null {
    const nftMatches = this.NFT_LABELS.filter(nft => label.includes(nft));
    const nftTagMatches = tags.filter(tag => this.NFT_TAGS.includes(tag));

    if (nftMatches.length > 0 || nftTagMatches.length > 0) {
      if (nftMatches.length > 0) reasoning.push(`Label contains NFT marketplace: ${nftMatches[0]}`);
      if (nftTagMatches.length > 0) reasoning.push(`Tagged as: ${nftTagMatches.join(', ')}`);

      return {
        type: AccountType.NFT_MARKETPLACE,
        confidence: 'high',
        subType: nftMatches[0] || nftTagMatches[0],
        reasoning
      };
    }
    return null;
  }

  private static checkMarketMaker(label: string, tags: string[], reasoning: string[]): AccountClassification | null {
    const mmMatches = this.MM_LABELS.filter(mm => label.includes(mm));
    const mmTagMatches = tags.filter(tag => this.MM_TAGS.includes(tag));

    if (mmMatches.length > 0 || mmTagMatches.length > 0) {
      if (mmMatches.length > 0) reasoning.push(`Label contains market maker: ${mmMatches[0]}`);
      if (mmTagMatches.length > 0) reasoning.push(`Tagged as: ${mmTagMatches.join(', ')}`);

      return {
        type: AccountType.MARKET_MAKER,
        confidence: 'high',
        subType: mmMatches[0] || mmTagMatches[0],
        reasoning
      };
    }
    return null;
  }

  private static checkProgram(label: string, tags: string[], reasoning: string[]): AccountClassification | null {
    const programMatches = this.PROGRAM_KEYWORDS.filter(keyword => label.includes(keyword));

    if (programMatches.length > 0) {
      reasoning.push(`Label contains program keywords: ${programMatches.join(', ')}`);
      return {
        type: AccountType.PROGRAM_AUTHORITY,
        confidence: 'high',
        subType: programMatches[0],
        reasoning
      };
    }
    return null;
  }

  private static checkValidator(label: string, tags: string[], reasoning: string[]): AccountClassification | null {
    const hasValidatorKeyword = label.includes('validator') && !label.includes('stake');
    const hasValidatorTag = tags.includes('validator');

    if (hasValidatorKeyword || hasValidatorTag) {
      if (hasValidatorKeyword) reasoning.push('Label contains validator keyword');
      if (hasValidatorTag) reasoning.push('Tagged as validator');

      return {
        type: AccountType.VALIDATOR,
        confidence: 'high',
        reasoning
      };
    }
    return null;
  }

  private static checkBehaviorPatterns(label: string, tags: string[], reasoning: string[]): AccountClassification | null {
    // Check for whale indicators
    const whaleIndicators = ['whale', 'large_holder', 'high_volume'];
    const whaleMatches = tags.filter(tag => whaleIndicators.includes(tag));

    if (whaleMatches.length > 0) {
      reasoning.push(`Tagged with whale indicators: ${whaleMatches.join(', ')}`);
      return {
        type: AccountType.WHALE,
        confidence: 'medium',
        reasoning
      };
    }

    // Check for bot indicators
    const botIndicators = ['bot', 'automated', 'high_frequency'];
    const botMatches = tags.filter(tag => botIndicators.includes(tag));

    if (botMatches.length > 0) {
      reasoning.push(`Tagged with bot indicators: ${botMatches.join(', ')}`);
      return {
        type: AccountType.BOT_TRADER,
        confidence: 'medium',
        reasoning
      };
    }

    return null;
  }

  /**
   * Helper method to check if an account is an exchange (CEX or DEX)
   */
  static isExchange(data: SolscanAccountData | null, options: { includeDex?: boolean } = {}): boolean {
    const classification = this.classifyAccount(data);
    
    if (classification.type === AccountType.CEX) {
      return true;
    }
    
    if (options.includeDex && classification.type === AccountType.DEX) {
      return true;
    }
    
    return false;
  }

  /**
   * Get human-readable description of account type
   */
  static getTypeDescription(type: AccountType): string {
    const descriptions = {
      [AccountType.CEX]: 'Centralized Exchange',
      [AccountType.DEX]: 'Decentralized Exchange',
      [AccountType.DEFI_PROTOCOL]: 'DeFi Protocol',
      [AccountType.BRIDGE]: 'Cross-chain Bridge',
      [AccountType.STAKING]: 'Staking Service',
      [AccountType.NFT_MARKETPLACE]: 'NFT Marketplace',
      [AccountType.VALIDATOR]: 'Validator Node',
      [AccountType.PROGRAM_AUTHORITY]: 'Program Authority',
      [AccountType.MARKET_MAKER]: 'Market Maker',
      [AccountType.WHALE]: 'Large Holder',
      [AccountType.BOT_TRADER]: 'Automated Trading Bot',
      [AccountType.INSTITUTIONAL]: 'Institutional Entity',
      [AccountType.UNKNOWN]: 'Unknown/Unlabeled'
    };
    
    return descriptions[type];
  }
}

// Integration with your existing classifyTokenHolders method:
/*
// In your classifyTokenHolders method:
for (const holder of holders) {
  const walletAddress = holder.walletAddress ?? 
    await this.getTokenAccountOwner(holder.tokenAccount);

  const history = await this.analyzeWalletHistory(walletAddress, tokenMint);

  // Get full metadata
  const ownerMetadata = await this.getAccountMetadata(walletAddress);
  
  // Use the robust classifier
  const classification = AccountTypeClassifier.classifyAccount(ownerMetadata);
  
  // Enhanced exchange detection
  const hasCexLabel = classification.type === AccountType.CEX;
  const isDexVenue = classification.type === AccountType.DEX;
  const isExchange = AccountTypeClassifier.isExchange(ownerMetadata, { includeDex: true });

  // ... rest of your logic ...

  classifications.push({
    address: walletAddress,
    category,
    balance: holder.balance,
    // ... other fields ...
    metadata: {
      label: ownerMetadata?.account_label,
      owner: walletAddress,
      tokenAccount: holder.tokenAccount,
      source: "automated_classification",
      isDex: isDexVenue,
      isCex: hasCexLabel,
      accountType: classification.type,
      accountSubType: classification.subType,
      classificationConfidence: classification.confidence,
      classificationReasoning: classification.reasoning,
      accountTags: ownerMetadata?.account_tags || [],
      fundedBy: ownerMetadata?.funded_by,
      activeAgeDays: ownerMetadata?.active_age,
    },
  });
}
*/