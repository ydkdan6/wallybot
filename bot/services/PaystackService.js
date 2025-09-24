import axios from 'axios';

class PaystackService {
  constructor(secretKey) {
    this.secretKey = secretKey;
    this.baseURL = 'https://api.paystack.co';
    this.headers = {
      'Authorization': `Bearer ${secretKey}`,
      'Content-Type': 'application/json'
    };
  }

  async createCustomer(customerData) {
    try {
      const response = await axios.post(
        `${this.baseURL}/customer`,
        customerData,
        { headers: this.headers }
      );
      
      if (response.data.status) {
        return response.data.data;
      } else {
        throw new Error(response.data.message);
      }
    } catch (error) {
      console.error('Create customer error:', error.response?.data || error.message);
      throw error;
    }
  }

  async createDedicatedAccount(customerCode) {
    try {
      const response = await axios.post(
        `${this.baseURL}/dedicated_account`,
        {
          customer: customerCode
        },
        { headers: this.headers }
      );
      
      if (response.data.status) {
        return response.data.data;
      } else {
        throw new Error(response.data.message);
      }
    } catch (error) {
      console.error('Create dedicated account error:', error.response?.data || error.message);
      throw error;
    }
  }

  async verifyTransaction(reference) {
    try {
      const response = await axios.get(
        `${this.baseURL}/transaction/verify/${reference}`,
        { headers: this.headers }
      );
      
      if (response.data.status) {
        return response.data.data;
      } else {
        throw new Error(response.data.message);
      }
    } catch (error) {
      console.error('Verify transaction error:', error.response?.data || error.message);
      throw error;
    }
  }

  async listTransactions(customerCode) {
    try {
      const response = await axios.get(
        `${this.baseURL}/transaction?customer=${customerCode}`,
        { headers: this.headers }
      );
      
      if (response.data.status) {
        return response.data.data;
      } else {
        throw new Error(response.data.message);
      }
    } catch (error) {
      console.error('List transactions error:', error.response?.data || error.message);
      throw error;
    }
  }

  async getBankList() {
    try {
      const response = await axios.get(
        `${this.baseURL}/bank`,
        { headers: this.headers }
      );
      
      if (response.data.status) {
        return response.data.data;
      } else {
        throw new Error(response.data.message);
      }
    } catch (error) {
      console.error('Get bank list error:', error.response?.data || error.message);
      throw error;
    }
  }

  async resolveBankAccount(accountNumber, bankCode) {
    try {
      const response = await axios.get(
        `${this.baseURL}/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
        { headers: this.headers }
      );
      
      if (response.data.status) {
        return response.data.data;
      } else {
        throw new Error(response.data.message);
      }
    } catch (error) {
      console.error('Resolve bank account error:', error.response?.data || error.message);
      throw error;
    }
  }
}

export default PaystackService;