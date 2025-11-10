class EnhancedNLPService {
  constructor(genAI) {
    this.genAI = genAI;
    this.model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    this.conversationMemory = new Map(); // Store recent interactions per user
  }

  /**
   * Store conversation context to avoid repetitive responses
   */
  storeContext(userId, intent, response) {
    if (!this.conversationMemory.has(userId)) {
      this.conversationMemory.set(userId, []);
    }
    
    const history = this.conversationMemory.get(userId);
    history.push({
      intent: intent.type,
      response,
      timestamp: Date.now()
    });
    
    // Keep only last 5 interactions
    if (history.length > 5) {
      history.shift();
    }
  }

  /**
   * Get recent conversation history for context
   */
  getRecentContext(userId) {
    const history = this.conversationMemory.get(userId) || [];
    // Only include recent interactions (last 2 minutes)
    const recentHistory = history.filter(h => Date.now() - h.timestamp < 120000);
    return recentHistory.map(h => `${h.intent}: ${h.response.substring(0, 100)}`).join('\n');
  }

  async processMessage(message, userId = 'default') {
    try {
      const recentContext = this.getRecentContext(userId);
      
      const prompt = `
        You are analyzing a user's message for a wallet app called QuickWallet.
        
        USER MESSAGE: "${message}"
        
        ${recentContext ? `RECENT CONVERSATION:\n${recentContext}\n` : ''}
        
        Classify the intent as ONE of these:
        - FUND_WALLET: User wants to add money to their wallet
        - SEND_MONEY: User wants to transfer money to someone
        - CHECK_BALANCE: User wants to see their wallet balance
        - TRANSACTION_HISTORY: User wants to view past transactions
        - ADD_BENEFICIARY: User wants to save a new contact/beneficiary
        - LIST_BENEFICIARIES: User wants to see their saved contacts
        - SEND_TO_BENEFICIARY: User wants to send money to a saved contact
        - HELP: User needs help or has questions about how things work
        - GENERAL_CHAT: Casual conversation, greetings, or unclear intent
        
        EXTRACTION RULES:
        
        For SEND_MONEY or SEND_TO_BENEFICIARY:
        - amount: Extract any number that looks like money (can be with ₦, naira, NGN, or just digits)
        - account_number: Only extract if exactly 10 digits
        - recipient_name: Any name mentioned after "to", "for", or similar
        - bank_name: Any bank name mentioned
        - beneficiary_nickname: A nickname/name if sending to saved contact
        
        For ADD_BENEFICIARY:
        - account_number: Only if exactly 10 digits
        - recipient_name: The person's name
        - bank_name: The bank name
        - nickname: What user wants to call this person (could be first name, nickname, etc.)
        
        For FUND_WALLET:
        - amount: Extract amount if mentioned
        
        IMPORTANT: 
        - Be smart about context - "send John 5000" means send ₦5000 to saved contact "John"
        - "add my brother's account 0123456789 GTB" means add beneficiary
        - If user just says a number like "5000", check recent context to understand intent
        
        Respond ONLY with valid JSON (no markdown, no extra text):
        {
          "type": "INTENT_TYPE",
          "amount": number or null,
          "account_number": "string or null",
          "recipient_name": "string or null",
          "bank_name": "string or null",
          "beneficiary_nickname": "string or null",
          "nickname": "string or null",
          "confidence": 0.0 to 1.0,
          "context_clues": "brief explanation of why you chose this intent"
        }
      `;

      const result = await this.model.generateContent(prompt);
      const response = result.response.text();
      
      try {
        // Extract JSON from response (handle markdown code blocks)
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return this.validateAndEnhanceResponse(parsed, message);
        }
      } catch (parseError) {
        console.error('JSON parsing error:', parseError);
      }

      return this.fallbackAnalysis(message);
      
    } catch (error) {
      console.error('NLP processing error:', error);
      return this.fallbackAnalysis(message);
    }
  }

  validateAndEnhanceResponse(parsed, message) {
    // Validate account number format
    if (parsed.account_number) {
      const cleaned = String(parsed.account_number).replace(/\s+/g, '');
      if (!/^\d{10}$/.test(cleaned)) {
        parsed.account_number = null;
      } else {
        parsed.account_number = cleaned;
      }
    }

    // Validate and parse amount
    if (parsed.amount) {
      const numAmount = typeof parsed.amount === 'string' 
        ? parseFloat(parsed.amount.replace(/[^0-9.]/g, ''))
        : parsed.amount;
      
      if (isNaN(numAmount) || numAmount <= 0) {
        parsed.amount = null;
      } else {
        parsed.amount = numAmount;
      }
    }

    // Clean up names and nicknames
    if (parsed.recipient_name) {
      parsed.recipient_name = parsed.recipient_name.trim();
    }

    if (parsed.beneficiary_nickname) {
      parsed.beneficiary_nickname = parsed.beneficiary_nickname.toLowerCase().trim();
    }

    if (parsed.nickname) {
      parsed.nickname = parsed.nickname.toLowerCase().trim();
    }

    // Ensure confidence is between 0 and 1
    if (!parsed.confidence || parsed.confidence < 0 || parsed.confidence > 1) {
      parsed.confidence = 0.7;
    }

    return parsed;
  }

  fallbackAnalysis(message) {
    const lowerMessage = message.toLowerCase();
    
    // Extract amount with better patterns
    const amountMatch = message.match(/(?:₦|naira|ngn)?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)|(\d{3,})/i);
    const amount = amountMatch ? parseFloat((amountMatch[1] || amountMatch[2]).replace(/,/g, '')) : null;
    
    // Extract account number
    const accountMatch = message.match(/\b(\d{10})\b/);
    const accountNumber = accountMatch ? accountMatch[1] : null;

    // Extract potential names/nicknames
    const namePatterns = [
      /(?:send|transfer|pay)\s+(?:to\s+)?([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i,
      /(?:for|to)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i,
      /(?:add|save)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i
    ];
    
    let potentialNickname = null;
    for (const pattern of namePatterns) {
      const match = message.match(pattern);
      if (match && match[1]) {
        potentialNickname = match[1].toLowerCase().trim();
        break;
      }
    }

    // Intent classification with priority order
    if (lowerMessage.match(/\b(help|how|what|guide|explain|tell me about)\b/)) {
      return { 
        type: 'HELP', 
        amount: null, 
        account_number: null, 
        recipient_name: null, 
        bank_name: null,
        beneficiary_nickname: null,
        nickname: null,
        confidence: 0.9
      };
    }

    if (lowerMessage.match(/(?:add|save|store|register)\s+(?:beneficiary|contact|account|number)/)) {
      return { 
        type: 'ADD_BENEFICIARY', 
        amount: null, 
        account_number: accountNumber, 
        recipient_name: null, 
        bank_name: null,
        beneficiary_nickname: null,
        nickname: potentialNickname,
        confidence: 0.85
      };
    }

    if (lowerMessage.match(/(?:list|show|see|view|display|my)\s+(?:beneficiaries|contacts|saved|people)/)) {
      return { 
        type: 'LIST_BENEFICIARIES', 
        amount: null, 
        account_number: null, 
        recipient_name: null, 
        bank_name: null,
        beneficiary_nickname: null,
        nickname: null,
        confidence: 0.9
      };
    }
    
    if (lowerMessage.match(/(?:fund|top.?up|recharge|credit|load|add money|deposit)/)) {
      return { 
        type: 'FUND_WALLET', 
        amount, 
        account_number: null, 
        recipient_name: null, 
        bank_name: null,
        beneficiary_nickname: null,
        nickname: null,
        confidence: 0.85
      };
    }
    
    if (lowerMessage.match(/(?:send|transfer|pay|give)/)) {
      // If no account number but has a potential nickname, likely sending to beneficiary
      if (!accountNumber && potentialNickname && !lowerMessage.includes('add') && !lowerMessage.includes('save')) {
        return { 
          type: 'SEND_TO_BENEFICIARY', 
          amount, 
          account_number: null, 
          recipient_name: null, 
          bank_name: null,
          beneficiary_nickname: potentialNickname,
          nickname: null,
          confidence: 0.75
        };
      }
      
      return { 
        type: 'SEND_MONEY', 
        amount, 
        account_number: accountNumber, 
        recipient_name: potentialNickname, 
        bank_name: null,
        beneficiary_nickname: null,
        nickname: null,
        confidence: 0.8
      };
    }
    
    if (lowerMessage.match(/(?:balance|wallet|how much|check)/)) {
      return { 
        type: 'CHECK_BALANCE', 
        amount: null, 
        account_number: null, 
        recipient_name: null, 
        bank_name: null,
        beneficiary_nickname: null,
        nickname: null,
        confidence: 0.9
      };
    }
    
    if (lowerMessage.match(/(?:history|transaction|statement|activity|recent)/)) {
      return { 
        type: 'TRANSACTION_HISTORY', 
        amount: null, 
        account_number: null, 
        recipient_name: null, 
        bank_name: null,
        beneficiary_nickname: null,
        nickname: null,
        confidence: 0.9
      };
    }
    
    return { 
      type: 'GENERAL_CHAT', 
      amount: null, 
      account_number: null, 
      recipient_name: null, 
      bank_name: null,
      beneficiary_nickname: null,
      nickname: null,
      confidence: 0.6
    };
  }

  async generateResponse(intent, context = {}, userId = 'default') {
    try {
      const recentContext = this.getRecentContext(userId);
      
      // Build rich context information
      let contextInfo = '';
      
      if (context.userName) {
        contextInfo += `User's name: ${context.userName}\n`;
      }
      
      if (context.balance !== undefined) {
        contextInfo += `Current wallet balance: ₦${context.balance.toLocaleString()}\n`;
      }
      
      if (context.beneficiaries && context.beneficiaries.length > 0) {
        contextInfo += `Saved contacts: ${context.beneficiaries.map(b => b.nickname).join(', ')}\n`;
      }
      
      if (context.lastTransaction) {
        contextInfo += `Last transaction: ${context.lastTransaction}\n`;
      }

      if (recentContext) {
        contextInfo += `\nRecent conversation:\n${recentContext}\n`;
      }

      const prompt = `
        You are Quickie, a friendly and helpful AI assistant for QuickWallet.
        
        USER INTENT: ${intent.type}
        CONFIDENCE: ${intent.confidence || 0.7}
        EXTRACTED DATA: ${JSON.stringify({
          amount: intent.amount,
          account_number: intent.account_number,
          recipient_name: intent.recipient_name,
          beneficiary_nickname: intent.beneficiary_nickname,
          nickname: intent.nickname
        })}
        
        CONTEXT:
        ${contextInfo}
        
        PERSONALITY GUIDELINES:
        - Be warm, friendly, and conversational (like talking to a friend)
        - Use natural language, contractions, and casual tone
        - Never repeat the same response twice - vary your wording
        - Be helpful without being robotic or scripted
        - Show empathy and understanding
        - Use emojis sparingly and naturally (1-2 max)
        - Keep responses concise (2-3 sentences usually)
        - Ask clarifying questions when needed, but make them specific and helpful
        - If something is missing, ask for it naturally without listing requirements
        
        INTENT-SPECIFIC BEHAVIOR:
        
        SEND_TO_BENEFICIARY:
        - If beneficiary not found: Suggest showing saved contacts or adding new one
        - If amount missing: Ask naturally "How much would you like to send?"
        - If found: Confirm before proceeding
        
        ADD_BENEFICIARY:
        - If missing info: Ask for one thing at a time (account number first, then bank, then nickname)
        - Be encouraging: "Great! Let's get them added..."
        
        SEND_MONEY:
        - If missing account: "Which account should I send this to?"
        - If missing amount: "How much would you like to send?"
        - If missing bank: "Which bank is this account with?"
        - Ask for one missing piece at a time
        
        FUND_WALLET:
        - Provide clear funding instructions
        - If amount mentioned: Confirm it naturally
        - Be encouraging about topping up
        
        CHECK_BALANCE:
        - Respond naturally about checking balance
        - Don't repeat if just checked recently
        
        TRANSACTION_HISTORY:
        - Acknowledge request naturally
        - Vary your responses
        
        LIST_BENEFICIARIES:
        - Acknowledge request to show contacts
        - Be natural
        
        HELP:
        - Explain features clearly and conversationally
        - Offer specific examples
        - Be encouraging about exploring features
        
        GENERAL_CHAT:
        - Engage naturally
        - Gently guide towards wallet features if appropriate
        - Be friendly and welcoming
        - Handle greetings warmly
        
        CRITICAL: 
        - NEVER use phrases like "I can help you with..." or "I'll help you..." repeatedly
        - NEVER list multiple options unless specifically asked
        - NEVER sound like a chatbot or script
        - AVOID repetitive structures like "You can... or you can..."
        - Vary your sentence structure and vocabulary
        - Be human, be natural, be helpful
        
        Generate ONE natural, conversational response (2-3 sentences max):
      `;

      const result = await this.model.generateContent(prompt);
      const response = result.response.text().trim();
      
      // Store in conversation memory
      this.storeContext(userId, intent, response);
      
      return response;
      
    } catch (error) {
      console.error('Response generation error:', error);
      return this.getDefaultResponse(intent.type, context);
    }
  }

  getDefaultResponse(intentType, context = {}) {
    // Multiple variations for each intent to avoid repetition
    const responses = {
      'FUND_WALLET': [
        "Ready to add some funds? Just let me know how much you'd like to top up! 💰",
        "Sure thing! How much would you like to add to your wallet?",
        "Let's get your wallet loaded up. What amount works for you?"
      ],
      'SEND_MONEY': [
        "Got it! Which account should I send this to?",
        "Sure, I can help with that. Who's receiving this payment?",
        "Alright, where should this money go?"
      ],
      'CHECK_BALANCE': [
        "Let me pull up your balance real quick! 💳",
        "On it! Checking your wallet now...",
        "Sure, let's see what you've got in there!"
      ],
      'TRANSACTION_HISTORY': [
        "I'll grab your recent transactions for you! 📊",
        "Coming right up! Getting your transaction history...",
        "Sure thing! Let me pull up your recent activity."
      ],
      'ADD_BENEFICIARY': [
        "Great! Let's save this contact. What's their account number?",
        "Sure, I can help you add someone new. Got their account details?",
        "Perfect! Who would you like to add to your contacts?"
      ],
      'LIST_BENEFICIARIES': [
        "Let me show you who you've saved! 📋",
        "Here are your saved contacts...",
        "Sure! Pulling up your contact list now."
      ],
      'SEND_TO_BENEFICIARY': [
        "Got it! How much would you like to send?",
        "Sure thing! What amount should I send to them?",
        "Alright, how much are we transferring?"
      ],
      'HELP': [
        "I'm here to help! You can fund your wallet, send money, check your balance, or save contacts. What would you like to do?",
        "Happy to help! I can assist with transfers, wallet funding, balance checks, and managing your saved contacts. What do you need?",
        "Hey! I can help you with all your wallet needs - from sending money to managing contacts. What's on your mind?"
      ],
      'GENERAL_CHAT': [
        "Hey! I'm Quickie, your wallet assistant. Need help with anything? 😊",
        "Hi there! How can I help you with your wallet today?",
        "Hello! Ready to help with transfers, balance checks, or anything else you need!"
      ]
    };
    
    // Pick a random variation to avoid repetition
    const options = responses[intentType] || responses['GENERAL_CHAT'];
    const randomIndex = Math.floor(Math.random() * options.length);
    
    return options[randomIndex];
  }

  /**
   * Clear conversation memory for a user (useful for new sessions)
   */
  clearContext(userId) {
    this.conversationMemory.delete(userId);
  }

  /**
   * Get conversation statistics (for monitoring)
   */
  getStats() {
    return {
      activeUsers: this.conversationMemory.size,
      totalInteractions: Array.from(this.conversationMemory.values())
        .reduce((sum, history) => sum + history.length, 0)
    };
  }
}

export default EnhancedNLPService;