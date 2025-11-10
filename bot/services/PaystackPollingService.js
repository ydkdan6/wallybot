// services/PaystackPollingService.js
import cron from 'node-cron';
import crypto from 'crypto';

class PaystackPollingService {
  constructor(paystackService, supabase, bot) {
    this.paystackService = paystackService;
    this.supabase = supabase;
    this.bot = bot;
    this.isPolling = false;
    this.pollInterval = null;
    this.processedTransactions = new Set();
    this.POLL_INTERVAL_MS = 30000; // Poll every 30 seconds
  }

  /**
   * Start polling for transactions
   */
  startPolling() {
    if (this.isPolling) {
      console.log('⚠️ Polling already active');
      return;
    }

    console.log('🔄 Starting Paystack transaction polling...');
    this.isPolling = true;

    // Initial poll
    this.pollTransactions();

    // Set up interval polling
    this.pollInterval = setInterval(() => {
      this.pollTransactions();
    }, this.POLL_INTERVAL_MS);

    // Also set up a cron job for more reliable scheduling (every minute)
    cron.schedule('* * * * *', () => {
      this.pollTransactions();
    });

    console.log(`✅ Polling active - checking every ${this.POLL_INTERVAL_MS / 1000} seconds`);
  }

  /**
   * Stop polling
   */
  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.isPolling = false;
    console.log('🛑 Polling stopped');
  }

  /**
   * Main polling function
   */
  async pollTransactions() {
    if (!this.isPolling) return;

    try {
      console.log('🔍 Polling for new transactions...');

      // Get all users with virtual accounts
      const { data: users, error: usersError } = await this.supabase
        .from('users')
        .select('*')
        .not('paystack_customer_code', 'is', null)
        .not('virtual_account_number', 'is', null);

      if (usersError) {
        console.error('Error fetching users:', usersError);
        return;
      }

      if (!users || users.length === 0) {
        console.log('📭 No users with virtual accounts found');
        return;
      }

      console.log(`👥 Checking ${users.length} users for transactions`);

      // Check each user's transactions
      for (const user of users) {
        await this.checkUserTransactions(user);
      }

      console.log('✅ Polling cycle completed');
    } catch (error) {
      console.error('❌ Polling error:', error);
    }
  }

  /**
   * Check transactions for a specific user
   */
  async checkUserTransactions(user) {
    try {
      // Get the user's last transaction timestamp
      const { data: lastTransaction } = await this.supabase
        .from('transactions')
        .select('created_at')
        .eq('user_id', user.id)
        .eq('type', 'credit')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      // Calculate time window (last 5 minutes or since last transaction)
      const now = new Date();
      const fromDate = lastTransaction 
        ? new Date(lastTransaction.created_at)
        : new Date(now.getTime() - 5 * 60 * 1000);

      // Fetch transactions from Paystack
      const paystackTransactions = await this.paystackService.getCustomerTransactions(
        user.paystack_customer_code,
        {
          from: fromDate.toISOString(),
          to: now.toISOString()
        }
      );

      if (!paystackTransactions || paystackTransactions.length === 0) {
        return;
      }

      console.log(`💰 Found ${paystackTransactions.length} transactions for ${user.email}`);

      // Process each transaction
      for (const transaction of paystackTransactions) {
        await this.processTransaction(user, transaction);
      }
    } catch (error) {
      console.error(`Error checking transactions for user ${user.id}:`, error);
    }
  }

  /**
   * Process a single transaction
   */
  async processTransaction(user, transaction) {
    try {
      // Skip if not successful
      if (transaction.status !== 'success') {
        return;
      }

      // Skip if already processed (check by reference)
      if (this.processedTransactions.has(transaction.reference)) {
        return;
      }

      // Check if transaction already exists in database
      const { data: existingTxn } = await this.supabase
        .from('transactions')
        .select('id')
        .eq('reference', transaction.reference)
        .single();

      if (existingTxn) {
        this.processedTransactions.add(transaction.reference);
        return;
      }

      // Validate it's a deposit to the virtual account
      if (transaction.channel !== 'dedicated_nuban') {
        return;
      }

      console.log(`🆕 New transaction found: ${transaction.reference}`);

      // Calculate amount (Paystack amounts are in kobo)
      const amount = transaction.amount / 100;

      // Get current balance
      const currentBalance = parseFloat(user.wallet_balance || 0);
      const newBalance = currentBalance + amount;

      // Create transaction record
      const { data: newTxn, error: txnError } = await this.supabase
        .from('transactions')
        .insert([{
          user_id: user.id,
          type: 'credit',
          amount: amount,
          service_fee: 0,
          description: `Wallet funding via ${transaction.metadata?.sender_bank || 'Bank'} transfer`,
          reference: transaction.reference,
          status: 'completed',
          metadata: {
            sender_name: transaction.metadata?.sender_name,
            sender_bank: transaction.metadata?.sender_bank,
            session_id: transaction.session?.id,
            paystack_id: transaction.id
          },
          created_at: transaction.transaction_date || new Date().toISOString()
        }])
        .select()
        .single();

      if (txnError) {
        console.error('Error creating transaction:', txnError);
        await this.logFailedFunding(user, transaction, txnError.message);
        return;
      }

      // Update user balance
      const { error: balanceError } = await this.supabase
        .from('users')
        .update({ 
          wallet_balance: newBalance,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id);

      if (balanceError) {
        console.error('Error updating balance:', balanceError);
        await this.logFailedFunding(user, transaction, balanceError.message);
        return;
      }

      console.log(`✅ Processed: ₦${amount.toLocaleString()} for ${user.email}`);
      console.log(`   New balance: ₦${newBalance.toLocaleString()}`);

      // Mark as processed
      this.processedTransactions.add(transaction.reference);

      // Log webhook event equivalent
      await this.supabase
        .from('webhook_events')
        .insert([{
          event_type: 'charge.success',
          reference: transaction.reference,
          customer_code: user.paystack_customer_code,
          amount: amount,
          status: 'success',
          event_data: {
            event: 'charge.success',
            data: transaction,
            source: 'polling'
          },
          processed: true,
          created_at: new Date().toISOString()
        }]);

      // Send notification to user via Telegram
      if (user.telegram_chat_id) {
        await this.sendFundingNotification(user, amount, newBalance, transaction);
      }

      // Clean up old processed transactions (keep last 1000)
      if (this.processedTransactions.size > 1000) {
        const entries = Array.from(this.processedTransactions);
        this.processedTransactions = new Set(entries.slice(-500));
      }

    } catch (error) {
      console.error('Error processing transaction:', error);
      await this.logFailedFunding(user, transaction, error.message);
    }
  }

  /**
   * Send funding notification to user
   */
  async sendFundingNotification(user, amount, newBalance, transaction) {
    try {
      const senderInfo = transaction.metadata?.sender_name 
        ? `\n👤 From: ${transaction.metadata.sender_name}`
        : '';
      
      const bankInfo = transaction.metadata?.sender_bank
        ? `\n🏦 Bank: ${transaction.metadata.sender_bank}`
        : '';

      await this.bot.sendMessage(
        user.telegram_chat_id,
        `✅ *Wallet Funded Successfully!*\n\n` +
        `💰 Amount: ₦${amount.toLocaleString()}\n` +
        `💵 New Balance: ₦${newBalance.toLocaleString()}\n` +
        `🔖 Reference: ${transaction.reference}${senderInfo}${bankInfo}\n\n` +
        `⏰ Time: ${new Date(transaction.transaction_date || Date.now()).toLocaleString()}\n\n` +
        `🎉 Your wallet has been credited successfully!\n` +
        `You can now send money or check your balance.`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      console.error('Error sending notification:', error);
    }
  }

  /**
   * Log failed funding attempts
   */
  async logFailedFunding(user, transaction, errorMessage) {
    try {
      await this.supabase
        .from('failed_fundings')
        .insert([{
          user_id: user.id,
          customer_code: user.paystack_customer_code,
          reference: transaction.reference,
          amount: transaction.amount / 100,
          error_message: errorMessage,
          transaction_data: transaction,
          resolved: false,
          created_at: new Date().toISOString()
        }]);

      console.error(`❌ Failed funding logged for user ${user.id}: ${errorMessage}`);
    } catch (logError) {
      console.error('Error logging failed funding:', logError);
    }
  }

  /**
   * Manual transaction sync for a specific user
   */
  async syncUserTransactions(userId) {
    try {
      const { data: user, error } = await this.supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      if (error || !user) {
        return { success: false, message: 'User not found' };
      }

      if (!user.paystack_customer_code) {
        return { success: false, message: 'User has no Paystack account' };
      }

      await this.checkUserTransactions(user);

      return { success: true, message: 'Sync completed' };
    } catch (error) {
      console.error('Manual sync error:', error);
      return { success: false, message: error.message };
    }
  }

  /**
   * Get polling statistics
   */
  getStats() {
    return {
      isPolling: this.isPolling,
      pollInterval: this.POLL_INTERVAL_MS,
      processedTransactionsCount: this.processedTransactions.size
    };
  }
}

export default PaystackPollingService;