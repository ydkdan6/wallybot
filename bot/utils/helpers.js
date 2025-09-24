const crypto = require('crypto');

class Helpers {
  static generateReference(prefix = 'TXN') {
    const timestamp = Date.now().toString();
    const random = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `${prefix}_${timestamp}_${random}`;
  }

  static formatCurrency(amount) {
    return `₦${parseFloat(amount).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }

  static validateAccountNumber(accountNumber) {
    return /^\d{10}$/.test(accountNumber);
  }

  static validateAmount(amount) {
    const num = parseFloat(amount);
    return !isNaN(num) && num > 0 && num <= 1000000; // Max 1M naira
  }

  static formatDate(date) {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  static sanitizeInput(input) {
    return input.toString().trim().replace(/[<>]/g, '');
  }

  static generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  static maskAccountNumber(accountNumber) {
    if (!accountNumber || accountNumber.length < 4) return accountNumber;
    const visible = accountNumber.slice(-4);
    const masked = '*'.repeat(accountNumber.length - 4);
    return masked + visible;
  }

  static calculateServiceFee(amount, feePercentage = 0.01, fixedFee = 10) {
    const percentageFee = amount * feePercentage;
    return Math.max(percentageFee, fixedFee);
  }

  static isBusinessHours() {
    const now = new Date();
    const hour = now.getHours();
    const dayOfWeek = now.getDay(); // 0 = Sunday, 6 = Saturday
    
    // Business hours: Monday-Friday 9AM-5PM
    return dayOfWeek >= 1 && dayOfWeek <= 5 && hour >= 9 && hour <= 17;
  }

  static getGreeting() {
    const hour = new Date().getHours();
    
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }

  static generateTransactionSummary(transactions) {
    const summary = {
      total: transactions.length,
      totalAmount: 0,
      credits: 0,
      debits: 0,
      transfers: 0,
      totalFees: 0
    };

    transactions.forEach(txn => {
      summary.totalAmount += parseFloat(txn.amount);
      summary.totalFees += parseFloat(txn.service_fee || 0);
      
      switch (txn.type) {
        case 'credit':
          summary.credits++;
          break;
        case 'debit':
          summary.debits++;
          break;
        case 'transfer':
          summary.transfers++;
          break;
      }
    });

    return summary;
  }
}

module.exports = Helpers;