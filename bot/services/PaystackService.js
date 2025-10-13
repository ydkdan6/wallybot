import axios from 'axios';

class PaystackService {
  constructor(secretKey) {
    this.secretKey = secretKey;
    this.baseURL = 'https://api.paystack.co';
  }

  /**
   * Resolve account number to get account name
   * @param {string} accountNumber - 10-digit account number
   * @param {string} bankCode - Bank code (e.g., '070' for Fidelity)
   * @returns {Promise<Object>} Account details
   */
  async resolveAccountNumber(accountNumber, bankCode) {
    try {
      console.log(`🔍 Resolving account: ${accountNumber} at bank: ${bankCode}`);
      
      const response = await axios.get(`${this.baseURL}/bank/resolve`, {
        params: {
          account_number: accountNumber,
          bank_code: bankCode
        },
        headers: {
          'Authorization': `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      console.log('✅ Account resolved successfully');
      return response.data;
      
    } catch (error) {
      console.error('❌ Account resolution failed:', error.response?.data || error.message);
      
      // Return structured error
      throw new Error(
        error.response?.data?.message || 
        'Failed to resolve account number'
      );
    }
  }

  /**
   * List all banks
   * @param {string} country - Country code (NG, GH, ZA)
   * @returns {Promise<Array>} List of banks
   */
  async listBanks(country = 'NG') {
    try {
      const response = await axios.get(`${this.baseURL}/bank`, {
        params: {
          country,
          perPage: 100
        },
        headers: {
          'Authorization': `Bearer ${this.secretKey}`
        },
        timeout: 10000
      });

      return response.data;
    } catch (error) {
      console.error('❌ Failed to list banks:', error.message);
      throw error;
    }
  }

  /**
   * Validate account (for South Africa)
   * @param {Object} accountData - Account validation data
   * @returns {Promise<Object>} Validation result
   */
  async validateAccount(accountData) {
    try {
      const response = await axios.post(
        `${this.baseURL}/bank/validate`,
        accountData,
        {
          headers: {
            'Authorization': `Bearer ${this.secretKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      return response.data;
    } catch (error) {
      console.error('❌ Account validation failed:', error.response?.data || error.message);
      throw new Error(
        error.response?.data?.message || 
        'Failed to validate account'
      );
    }
  }

  /**
   * Create transfer recipient
   * @param {Object} recipientData - Recipient details
   * @returns {Promise<Object>} Recipient creation result
   */
  async createTransferRecipient(recipientData) {
    try {
      const response = await axios.post(
        `${this.baseURL}/transferrecipient`,
        recipientData,
        {
          headers: {
            'Authorization': `Bearer ${this.secretKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      return response.data;
    } catch (error) {
      console.error('❌ Failed to create recipient:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Initiate transfer
   * @param {Object} transferData - Transfer details
   * @returns {Promise<Object>} Transfer result
   */
  async initiateTransfer(transferData) {
    try {
      const response = await axios.post(
        `${this.baseURL}/transfer`,
        transferData,
        {
          headers: {
            'Authorization': `Bearer ${this.secretKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      return response.data;
    } catch (error) {
      console.error('❌ Transfer failed:', error.response?.data || error.message);
      throw error;
    }
  }
}

export default PaystackService;