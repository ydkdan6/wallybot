class NLPService {
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
        - SEND_MONEY: User wants to transfer money (extract amount, recipient details)
        - CHECK_BALANCE: User wants to check wallet balance
        - TRANSACTION_HISTORY: User wants to see transaction history
        - GENERAL_CHAT: General conversation or questions
        
        For SEND_MONEY, extract:
        - amount (number)
        - account_number (10 digits if mentioned)
        - recipient_name (if mentioned)
        - bank name (if mentioned)
        
        For FUND_WALLET, extract:
        - amount (number if mentioned)
        
        Respond in JSON format only:
        {
          "type": "INTENT_TYPE",
          "amount": number or null,
          "account_number": "string or null",
          "recipient_name": "string or null",
          "confidence": 0.0-1.0
        }
      `;

      const result = await this.model.generateContent(prompt);
      const response = result.response.text();
      
      try {
        // Extract JSON from response
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return parsed;
        }
      } catch (parseError) {
        console.error('JSON parsing error:', parseError);
      }

      // Fallback to keyword-based analysis
      return this.fallbackAnalysis(message);
      
    } catch (error) {
      console.error('NLP processing error:', error);
      return this.fallbackAnalysis(message);
    }
  }

  fallbackAnalysis(message) {
    const lowerMessage = message.toLowerCase();
    
    // Extract amount
    const amountMatch = message.match(/(\d+(?:,\d+)*(?:\.\d{2})?)/);
    const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : null;
    
    // Extract account number
    const accountMatch = message.match(/\b\d{10}\b/);
    const accountNumber = accountMatch ? accountMatch[0] : null;
    
    if (lowerMessage.includes('fund') || lowerMessage.includes('credit') || lowerMessage.includes('load')) {
      return { type: 'FUND_WALLET', amount, account_number: null, recipient_name: null };
    }
    
    if (lowerMessage.includes('send') || lowerMessage.includes('transfer') || lowerMessage.includes('pay')) {
      return { type: 'SEND_MONEY', amount, account_number: accountNumber, recipient_name: null };
    }
    
    if (lowerMessage.includes('balance') || lowerMessage.includes('wallet')) {
      return { type: 'CHECK_BALANCE', amount: null, account_number: null, recipient_name: null };
    }
    
    if (lowerMessage.includes('history') || lowerMessage.includes('transaction')) {
      return { type: 'TRANSACTION_HISTORY', amount: null, account_number: null, recipient_name: null };
    }
    
    return { type: 'GENERAL_CHAT', amount: null, account_number: null, recipient_name: null };
  }

  async generateResponse(message) {
    try {
      const prompt = `
        You are a friendly AI assistant for QuickWallet, a financial service.
        Respond to this user message in a helpful, conversational way:
        "${message}"
        
        Keep responses concise and friendly. Focus on financial services like:
        - Wallet funding
        - Money transfers
        - Balance checks
        - Transaction history
        
        Always maintain a helpful and professional tone.
      `;

      const result = await this.model.generateContent(prompt);
      return result.response.text();
      
    } catch (error) {
      console.error('Response generation error:', error);
      return "I'm here to help with your wallet! You can fund your wallet, send money, check balance, or view transaction history. How can I assist you? 😊";
    }
  }
}

module.exports = NLPService;