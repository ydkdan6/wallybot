class EnhancedNLPService {
  constructor(genAI) {
    this.genAI = genAI;
    this.model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  }

  async processMessage(message) {
    try {
      const prompt = `
        Analyze this user message for financial transaction intent:
        "${message}"
        
        Classify the intent as one of:
        - FUND_WALLET: User wants to fund their wallet
        - SEND_MONEY: User wants to transfer money
        - CHECK_BALANCE: User wants to check wallet balance
        - TRANSACTION_HISTORY: User wants to see transaction history
        - ADD_BENEFICIARY: User wants to add a new beneficiary
        - LIST_BENEFICIARIES: User wants to see saved beneficiaries
        - SEND_TO_BENEFICIARY: User wants to send money to a saved beneficiary
        - GENERAL_CHAT: General conversation or questions
        
        For SEND_MONEY, extract:
        - amount (number)
        - account_number (10 digits if mentioned)
        - recipient_name (if mentioned)
        - bank_name (if mentioned)
        - beneficiary_nickname (if user mentions sending to a saved contact)
        
        For ADD_BENEFICIARY, extract:
        - account_number (10 digits)
        - recipient_name (if mentioned)
        - bank_name (if mentioned)
        - nickname (what user wants to call this beneficiary)
        
        For SEND_TO_BENEFICIARY, extract:
        - amount (number)
        - beneficiary_nickname (the saved contact name)
        
        For FUND_WALLET, extract:
        - amount (number if mentioned)
        
        Respond in JSON format only:
        {
          "type": "INTENT_TYPE",
          "amount": number or null,
          "account_number": "string or null",
          "recipient_name": "string or null",
          "bank_name": "string or null",
          "beneficiary_nickname": "string or null",
          "nickname": "string or null",
          "confidence": 0.0-1.0
        }
      `;

      const result = await this.model.generateContent(prompt);
      const response = result.response.text();
      
      try {
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
    if (parsed.account_number && !/^\d{10}$/.test(parsed.account_number)) {
      parsed.account_number = null;
    }

    // Validate amount
    if (parsed.amount && (isNaN(parsed.amount) || parsed.amount <= 0)) {
      parsed.amount = null;
    }

    // Clean up recipient name
    if (parsed.recipient_name) {
      parsed.recipient_name = parsed.recipient_name.trim();
    }

    // Clean up nicknames
    if (parsed.beneficiary_nickname) {
      parsed.beneficiary_nickname = parsed.beneficiary_nickname.toLowerCase().trim();
    }

    if (parsed.nickname) {
      parsed.nickname = parsed.nickname.toLowerCase().trim();
    }

    return parsed;
  }

  fallbackAnalysis(message) {
    const lowerMessage = message.toLowerCase();
    
    // Extract amount
    const amountMatch = message.match(/(?:₦|naira|ngn)?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/i);
    const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : null;
    
    // Extract account number
    const accountMatch = message.match(/\b\d{10}\b/);
    const accountNumber = accountMatch ? accountMatch[0] : null;

    // Extract potential beneficiary nickname (words that could be names)
    const nicknameMatch = message.match(/(?:send|transfer|pay)\s+(?:to\s+)?([a-zA-Z]+(?:\s+[a-zA-Z]+)*)/i);
    const potentialNickname = nicknameMatch ? nicknameMatch[1].toLowerCase().trim() : null;

    // Intent classification with enhanced patterns
    if (lowerMessage.match(/(?:add|save|store)\s+(?:beneficiary|contact|account)/)) {
      return { 
        type: 'ADD_BENEFICIARY', 
        amount: null, 
        account_number: accountNumber, 
        recipient_name: null, 
        bank_name: null,
        beneficiary_nickname: null,
        nickname: potentialNickname
      };
    }

    if (lowerMessage.match(/(?:list|show|see)\s+(?:beneficiaries|contacts|saved)/)) {
      return { 
        type: 'LIST_BENEFICIARIES', 
        amount: null, 
        account_number: null, 
        recipient_name: null, 
        bank_name: null,
        beneficiary_nickname: null,
        nickname: null
      };
    }
    
    if (lowerMessage.includes('fund') || lowerMessage.includes('credit') || lowerMessage.includes('load')) {
      return { 
        type: 'FUND_WALLET', 
        amount, 
        account_number: null, 
        recipient_name: null, 
        bank_name: null,
        beneficiary_nickname: null,
        nickname: null
      };
    }
    
    if (lowerMessage.includes('send') || lowerMessage.includes('transfer') || lowerMessage.includes('pay')) {
      // If no account number but has a potential nickname, might be sending to beneficiary
      if (!accountNumber && potentialNickname) {
        return { 
          type: 'SEND_TO_BENEFICIARY', 
          amount, 
          account_number: null, 
          recipient_name: null, 
          bank_name: null,
          beneficiary_nickname: potentialNickname,
          nickname: null
        };
      }
      
      return { 
        type: 'SEND_MONEY', 
        amount, 
        account_number: accountNumber, 
        recipient_name: null, 
        bank_name: null,
        beneficiary_nickname: null,
        nickname: null
      };
    }
    
    if (lowerMessage.includes('balance') || lowerMessage.includes('wallet')) {
      return { 
        type: 'CHECK_BALANCE', 
        amount: null, 
        account_number: null, 
        recipient_name: null, 
        bank_name: null,
        beneficiary_nickname: null,
        nickname: null
      };
    }
    
    if (lowerMessage.includes('history') || lowerMessage.includes('transaction')) {
      return { 
        type: 'TRANSACTION_HISTORY', 
        amount: null, 
        account_number: null, 
        recipient_name: null, 
        bank_name: null,
        beneficiary_nickname: null,
        nickname: null
      };
    }
    
    return { 
      type: 'GENERAL_CHAT', 
      amount: null, 
      account_number: null, 
      recipient_name: null, 
      bank_name: null,
      beneficiary_nickname: null,
      nickname: null
    };
  }

  async generateResponse(intent, context = {}) {
    try {
      let contextInfo = '';
      if (context.beneficiaries && context.beneficiaries.length > 0) {
        contextInfo = `\nUser's saved beneficiaries: ${context.beneficiaries.map(b => b.nickname).join(', ')}`;
      }

      const prompt = `
        You are a friendly AI assistant for QuickWallet, a financial service.
        User intent: ${intent.type}
        ${contextInfo}
        
        Generate a helpful response based on the intent. For:
        - SEND_TO_BENEFICIARY: If beneficiary not found, ask user to clarify or add new beneficiary
        - ADD_BENEFICIARY: Guide user through the process if missing info
        - SEND_MONEY: Ask for missing details (amount, account number, etc.)
        - FUND_WALLET: Provide funding instructions
        - CHECK_BALANCE: Acknowledge the request
        - TRANSACTION_HISTORY: Acknowledge the request
        - LIST_BENEFICIARIES: Acknowledge the request
        - GENERAL_CHAT: Be helpful about wallet services
        
        Keep responses concise, friendly, and actionable.
      `;

      const result = await this.model.generateContent(prompt);
      return result.response.text();
      
    } catch (error) {
      console.error('Response generation error:', error);
      return this.getDefaultResponse(intent.type);
    }
  }

  getDefaultResponse(intentType) {
    const responses = {
      'FUND_WALLET': "I can help you fund your wallet! You can transfer money to your dedicated account number or use other funding methods. 💰",
      'SEND_MONEY': "I can help you send money! Please provide the recipient's account number and the amount you'd like to send. 📤",
      'CHECK_BALANCE': "Let me check your wallet balance for you! 💳",
      'TRANSACTION_HISTORY': "I'll get your transaction history right away! 📊",
      'ADD_BENEFICIARY': "I can help you save a new beneficiary! Please provide their account details and a nickname. 👤",
      'LIST_BENEFICIARIES': "Here are your saved beneficiaries! 📋",
      'SEND_TO_BENEFICIARY': "I can help you send money to your saved contact! Please specify the amount and beneficiary. 💸",
      'GENERAL_CHAT': "I'm here to help with your wallet! You can fund your wallet, send money, check balance, or manage beneficiaries. How can I assist you? 😊"
    };
    
    return responses[intentType] || responses['GENERAL_CHAT'];
  }
}

export default EnhancedNLPService;