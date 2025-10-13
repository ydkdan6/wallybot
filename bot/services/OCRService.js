import axios from 'axios';
import FormData from 'form-data';

class OCRService {
  constructor(apiKey, paystackService = null) {
    this.apiKey = apiKey;
    this.baseURL = 'https://ocr-extract-text.p.rapidapi.com';
    this.paystackService = paystackService;
    
    // Enhanced bank name mappings with variations
    this.bankMappings = {
      // Access Bank variations
      'access': { name: 'Access Bank', code: '044' },
      'access bank': { name: 'Access Bank', code: '044' },
      'access diamond': { name: 'Access Bank', code: '044' },
      
      // GTBank variations
      'gtbank': { name: 'Guaranty Trust Bank', code: '058' },
      'guaranty trust': { name: 'Guaranty Trust Bank', code: '058' },
      'gt bank': { name: 'Guaranty Trust Bank', code: '058' },
      'gtb': { name: 'Guaranty Trust Bank', code: '058' },
      
      // Zenith Bank variations
      'zenith': { name: 'Zenith Bank', code: '057' },
      'zenith bank': { name: 'Zenith Bank', code: '057' },
      
      // UBA variations
      'uba': { name: 'United Bank for Africa', code: '033' },
      'united bank': { name: 'United Bank for Africa', code: '033' },
      'united bank for africa': { name: 'United Bank for Africa', code: '033' },
      
      // First Bank variations
      'first bank': { name: 'First Bank of Nigeria', code: '011' },
      'firstbank': { name: 'First Bank of Nigeria', code: '011' },
      'fbn': { name: 'First Bank of Nigeria', code: '011' },
      
      // Fidelity Bank
      'fidelity': { name: 'Fidelity Bank', code: '070' },
      'fidelity bank': { name: 'Fidelity Bank', code: '070' },
      
      // Union Bank
      'union': { name: 'Union Bank of Nigeria', code: '032' },
      'union bank': { name: 'Union Bank of Nigeria', code: '032' },
      
      // Wema Bank
      'wema': { name: 'Wema Bank', code: '035' },
      'wema bank': { name: 'Wema Bank', code: '035' },
      'alat': { name: 'Wema Bank', code: '035' },
      
      // Sterling Bank
      'sterling': { name: 'Sterling Bank', code: '232' },
      'sterling bank': { name: 'Sterling Bank', code: '232' },
      
      // Stanbic IBTC
      'stanbic': { name: 'Stanbic IBTC Bank', code: '221' },
      'stanbic ibtc': { name: 'Stanbic IBTC Bank', code: '221' },
      
      // FCMB
      'fcmb': { name: 'First City Monument Bank', code: '214' },
      'first city': { name: 'First City Monument Bank', code: '214' },
      
      // Ecobank
      'ecobank': { name: 'Ecobank Nigeria', code: '050' },
      'eco bank': { name: 'Ecobank Nigeria', code: '050' },
      
      // Heritage Bank
      'heritage': { name: 'Heritage Bank', code: '030' },
      'heritage bank': { name: 'Heritage Bank', code: '030' },
      
      // Keystone Bank
      'keystone': { name: 'Keystone Bank', code: '082' },
      'keystone bank': { name: 'Keystone Bank', code: '082' },
      
      // Polaris Bank
      'polaris': { name: 'Polaris Bank', code: '076' },
      'polaris bank': { name: 'Polaris Bank', code: '076' },
      'skye': { name: 'Polaris Bank', code: '076' },
      'skye bank': { name: 'Polaris Bank', code: '076' },
      
      // Unity Bank
      'unity': { name: 'Unity Bank', code: '215' },
      'unity bank': { name: 'Unity Bank', code: '215' },
      
      // Providus Bank
      'providus': { name: 'Providus Bank', code: '101' },
      'providus bank': { name: 'Providus Bank', code: '101' },
      
      // Kuda Bank
      'kuda': { name: 'Kuda Bank', code: '50211' },
      'kuda bank': { name: 'Kuda Bank', code: '50211' },
      'kuda mfb': { name: 'Kuda Bank', code: '50211' },
      
      // OPay
      'opay': { name: 'OPay', code: '999992' },
      'opay digital': { name: 'OPay', code: '999992' },
      
      // Moniepoint
      'moniepoint': { name: 'Moniepoint MFB', code: '50515' },
      'moniepoint mfb': { name: 'Moniepoint MFB', code: '50515' },
      
      // PalmPay
      'palmpay': { name: 'PalmPay', code: '999991' },
      'palm pay': { name: 'PalmPay', code: '999991' },
      
      // VFD Microfinance Bank
      'vfd': { name: 'VFD Microfinance Bank', code: '566' },
      'vfd mfb': { name: 'VFD Microfinance Bank', code: '566' },
      
      // Rubies Bank
      'rubies': { name: 'Rubies MFB', code: '125' },
      'rubies bank': { name: 'Rubies MFB', code: '125' },
      
      // Standard Chartered
      'standard chartered': { name: 'Standard Chartered Bank', code: '068' },
      'standard': { name: 'Standard Chartered Bank', code: '068' },
      
      // Citibank
      'citibank': { name: 'Citibank Nigeria', code: '023' },
      'citi': { name: 'Citibank Nigeria', code: '023' }
    };
  }

  async extractText(imageUrl) {
    try {
      console.log('📷 Starting OCR extraction from:', imageUrl);
      
      // Download image first
      const imageResponse = await axios.get(imageUrl, { 
        responseType: 'arraybuffer',
        timeout: 30000 
      });
      
      console.log('✅ Image downloaded, size:', imageResponse.data.length, 'bytes');
      
      const formData = new FormData();
      formData.append('image', Buffer.from(imageResponse.data), {
        filename: 'image.jpg',
        contentType: 'image/jpeg'
      });

      const response = await axios.post(
        `${this.baseURL}/ocr`,
        formData,
        {
          headers: {
            ...formData.getHeaders(),
            'x-rapidapi-key': this.apiKey,
            'x-rapidapi-host': 'ocr-extract-text.p.rapidapi.com'
          },
          timeout: 30000
        }
      );

      console.log('✅ OCR response received');
      const extractedText = response.data.text || response.data.ParsedText || '';
      console.log('📝 Extracted text:', extractedText.substring(0, 200) + '...');
      
      return extractedText;
    } catch (error) {
      console.error('❌ OCR extraction error:', error.response?.data || error.message);
      
      // Fallback: Try alternative OCR approach if available
      if (error.response?.status === 401 || error.response?.status === 403) {
        console.error('❌ OCR API authentication failed. Check your RapidAPI key.');
      }
      
      throw new Error(`OCR failed: ${error.message}`);
    }
  }

  extractAccountInfo(text) {
    console.log('🔍 Extracting account info from text...');
    
    const accountInfo = {
      accountNumber: null,
      bankName: null,
      bankCode: null,
      accountName: null,
      amount: null,
      accountType: 'personal'
    };

    // Clean the text
    const cleanText = text.replace(/\s+/g, ' ').trim();
    console.log('🧹 Cleaned text length:', cleanText.length);

    // Extract account number (10 digits, may have spaces or dashes)
    const accountPatterns = [
      /(?:account|acc|a\/c|acct)[\s:]*(\d{10})/gi,
      /(?:number|no|#)[\s:]*(\d{10})/gi,
      /\b(\d{10})\b/g,
      /(\d{3}[\s\-]?\d{3}[\s\-]?\d{4})/g
    ];

    for (const pattern of accountPatterns) {
      const matches = cleanText.match(pattern);
      if (matches) {
        for (const match of matches) {
          const digits = match.replace(/\D/g, '');
          if (digits.length === 10 && /^\d{10}$/.test(digits)) {
            accountInfo.accountNumber = digits;
            console.log('✅ Account number found:', accountInfo.accountNumber);
            break;
          }
        }
        if (accountInfo.accountNumber) break;
      }
    }

    // Extract bank name using fuzzy matching
    const lowerText = cleanText.toLowerCase();
    let bestMatch = null;
    let bestMatchLength = 0;

    for (const [keyword, bankInfo] of Object.entries(this.bankMappings)) {
      if (lowerText.includes(keyword)) {
        if (keyword.length > bestMatchLength) {
          bestMatch = bankInfo;
          bestMatchLength = keyword.length;
        }
      }
    }

    if (bestMatch) {
      accountInfo.bankName = bestMatch.name;
      accountInfo.bankCode = bestMatch.code;
      console.log('✅ Bank detected:', accountInfo.bankName, '(', accountInfo.bankCode, ')');
    } else {
      console.log('⚠️ No bank detected in text');
    }

    // Extract account name (usually appears near "name:" or before account number)
    const namePatterns = [
      /(?:account\s+name|name|beneficiary)[\s:]+([A-Z][A-Za-z\s]{5,40})/gi,
      /([A-Z][A-Za-z\s]{5,40})(?:\s+(?:account|a\/c))/gi
    ];

    for (const pattern of namePatterns) {
      const match = cleanText.match(pattern);
      if (match && match[1]) {
        accountInfo.accountName = match[1].trim();
        console.log('✅ Account name found:', accountInfo.accountName);
        break;
      }
    }

    // Extract amount (if present)
    const amountPatterns = [
      /(?:amount|amt|NGN|₦)[\s:]*([0-9,]+(?:\.\d{2})?)/gi,
      /₦\s*([0-9,]+(?:\.\d{2})?)/g,
      /\b([0-9,]+\.\d{2})\s*(?:naira|NGN)/gi
    ];

    for (const pattern of amountPatterns) {
      const match = cleanText.match(pattern);
      if (match) {
        const amountStr = match[0].replace(/[^\d.,]/g, '').replace(/,/g, '');
        const amount = parseFloat(amountStr);
        if (amount > 0 && amount < 10000000) { // Sanity check
          accountInfo.amount = amount;
          console.log('✅ Amount found:', accountInfo.amount);
          break;
        }
      }
    }

    console.log('📊 Extraction summary:', {
      accountNumber: accountInfo.accountNumber ? 'Found' : 'Not found',
      bankName: accountInfo.bankName || 'Not found',
      accountName: accountInfo.accountName || 'Not found',
      amount: accountInfo.amount || 'Not found'
    });

    return accountInfo;
  }

  // Enhanced method that validates with Paystack
  async extractAndValidateAccountInfo(text) {
    console.log('🔍 Extracting and validating account info...');
    
    // First extract basic info
    const extractedInfo = this.extractAccountInfo(text);

    // If we have account number and bank code, validate with Paystack
    if (extractedInfo.accountNumber && extractedInfo.bankCode && this.paystackService) {
      try {
        console.log('🔄 Validating account with Paystack...');
        
        const validation = await this.paystackService.resolveAccountNumber(
          extractedInfo.accountNumber,
          extractedInfo.bankCode
        );

        if (validation.status && validation.data) {
          extractedInfo.accountName = validation.data.account_name;
          extractedInfo.validated = true;
          console.log('✅ Account validated:', extractedInfo.accountName);
        } else {
          extractedInfo.validated = false;
          console.log('❌ Account validation failed');
        }
      } catch (error) {
        console.error('❌ Paystack validation error:', error.message);
        extractedInfo.validated = false;
        extractedInfo.validationError = error.message;
      }
    } else {
      console.log('⚠️ Cannot validate - missing account number or bank code');
      extractedInfo.validated = false;
    }

    return extractedInfo;
  }

  // Alternative method using Google Vision API (if you have it)
  async extractTextWithGoogleVision(imageUrl) {
    // This is a placeholder for Google Vision integration
    // You would need @google-cloud/vision package and credentials
    throw new Error('Google Vision not implemented yet');
  }

  // Fallback: Simple pattern matching for common statement formats
  extractFromBankStatement(text) {
    const info = this.extractAccountInfo(text);
    
    // Additional patterns specific to bank statements
    const statementPatterns = {
      // GTBank statement format
      gtbank: /Account\s+Number:\s*(\d{10})/i,
      
      // Access Bank statement format
      access: /Account:\s*(\d{10})/i,
      
      // Zenith Bank statement format
      zenith: /A\/C\s+No:\s*(\d{10})/i,
      
      // First Bank statement format
      firstbank: /Account\s+No\.:\s*(\d{10})/i
    };

    // Try statement-specific patterns if basic extraction failed
    if (!info.accountNumber) {
      for (const pattern of Object.values(statementPatterns)) {
        const match = text.match(pattern);
        if (match && match[1]) {
          info.accountNumber = match[1];
          break;
        }
      }
    }

    return info;
  }

  // Helper method to resolve bank name to code
  resolveBankCode(bankName) {
    if (!bankName) return null;
    
    const lowerName = bankName.toLowerCase();
    for (const [keyword, bankInfo] of Object.entries(this.bankMappings)) {
      if (lowerName.includes(keyword) || keyword.includes(lowerName)) {
        return bankInfo.code;
      }
    }
    
    return null;
  }

  // Helper method to get all supported banks
  getSupportedBanks() {
    const uniqueBanks = new Map();
    
    for (const bankInfo of Object.values(this.bankMappings)) {
      uniqueBanks.set(bankInfo.code, bankInfo);
    }
    
    return Array.from(uniqueBanks.values());
  }
}

export default OCRService;