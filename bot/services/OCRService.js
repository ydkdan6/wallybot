const axios = require('axios');
const FormData = require('form-data');

class OCRService {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseURL = 'https://ocr-extract-text.p.rapidapi.com';
  }

  async extractText(imageUrl) {
    try {
      const formData = new FormData();
      
      // Download image first
      const imageResponse = await axios.get(imageUrl, { responseType: 'stream' });
      formData.append('image', imageResponse.data);

      const response = await axios.post(
        `${this.baseURL}/ocr`,
        formData,
        {
          headers: {
            ...formData.getHeaders(),
            'x-rapidapi-key': this.apiKey,
            'x-rapidapi-host': 'ocr-extract-text.p.rapidapi.com'
          }
        }
      );

      return response.data.text || '';
    } catch (error) {
      console.error('OCR extraction error:', error.response?.data || error.message);
      throw error;
    }
  }

  extractAccountInfo(text) {
    const accountInfo = {
      accountNumber: null,
      bankName: null
    };

    // Extract account number (10 digits)
    const accountNumberRegex = /\b\d{10}\b/g;
    const accountMatches = text.match(accountNumberRegex);
    
    if (accountMatches) {
      accountInfo.accountNumber = accountMatches[0];
    }

    // Extract bank name (common Nigerian banks)
    const bankNames = [
      'Access Bank', 'Zenith Bank', 'Guaranty Trust Bank', 'GTBank', 'UBA',
      'Union Bank', 'First Bank', 'Fidelity Bank', 'Wema Bank', 'Sterling Bank',
      'Stanbic IBTC', 'Citibank', 'Heritage Bank', 'Keystone Bank', 'Unity Bank',
      'FCMB', 'Ecobank', 'Diamond Bank', 'Skye Bank', 'Standard Chartered', 'Opay', 'Moniepoint', 
      'Kuda', 'Rubies Bank', 'VFD Microfinance Bank', 'ALAT by Wema'
    ];

    for (const bank of bankNames) {
      if (text.toLowerCase().includes(bank.toLowerCase())) {
        accountInfo.bankName = bank;
        break;
      }
    }

    return accountInfo;
  }
}

module.exports = OCRService;