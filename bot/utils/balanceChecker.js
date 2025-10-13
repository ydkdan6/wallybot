/**
 * Balance Checker & Reconciliation Utility
 * 
 * This script provides utilities to:
 * 1. Check individual user balances
 * 2. Verify balance accuracy against transactions
 * 3. Reconcile balances with Paystack
 * 4. Generate balance reports
 */

import { createClient } from '@supabase/supabase-js';
import PaystackService from '../services/PaystackService';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const paystackService = new PaystackService(process.env.PAYSTACK_SECRET_KEY);

class BalanceChecker {
  /**
   * Check a specific user's balance
   */
  async checkUserBalance(userId) {
    try {
      console.log(`\n🔍 Checking balance for user: ${userId}\n`);

      // Get user details
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      if (userError) throw userError;

      console.log('👤 User Details:');
      console.log(`   Name: ${user.first_name} ${user.last_name}`);
      console.log(`   Email: ${user.email}`);
      console.log(`   Current Balance: ₦${parseFloat(user.wallet_balance).toLocaleString()}`);

      // Get all completed transactions
      const { data: transactions } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'completed')
        .order('created_at', { ascending: true });

      // Calculate balance from transactions
      let calculatedBalance = 0;
      const txnSummary = {
        credits: 0,
        debits: 0,
        fees: 0,
        count: transactions?.length || 0
      };

      if (transactions) {
        transactions.forEach(txn => {
          const amount = parseFloat(txn.amount);
          const fee = parseFloat(txn.service_fee || 0);

          if (txn.type === 'credit') {
            calculatedBalance += amount;
            txnSummary.credits += amount;
          } else if (txn.type === 'transfer' || txn.type === 'debit') {
            calculatedBalance -= (amount + fee);
            txnSummary.debits += amount;
            txnSummary.fees += fee;
          }
        });
      }

      console.log('\n📊 Transaction Summary:');
      console.log(`   Total Transactions: ${txnSummary.count}`);
      console.log(`   Total Credits: ₦${txnSummary.credits.toLocaleString()}`);
      console.log(`   Total Debits: ₦${txnSummary.debits.toLocaleString()}`);
      console.log(`   Total Fees: ₦${txnSummary.fees.toLocaleString()}`);
      console.log(`   Calculated Balance: ₦${calculatedBalance.toLocaleString()}`);

      const currentBalance = parseFloat(user.wallet_balance);
      const difference = currentBalance - calculatedBalance;

      console.log('\n✅ Balance Verification:');
      console.log(`   Database Balance: ₦${currentBalance.toLocaleString()}`);
      console.log(`   Calculated Balance: ₦${calculatedBalance.toLocaleString()}`);
      console.log(`   Difference: ₦${difference.toLocaleString()}`);

      if (Math.abs(difference) < 0.01) {
        console.log('   Status: ✅ BALANCED');
      } else {
        console.log(`   Status: ⚠️ MISMATCH (${difference > 0 ? 'OVERPAID' : 'UNDERPAID'})`);
      }

      // Check Paystack balance if customer code exists
      if (user.paystack_customer_code) {
        console.log('\n💰 Paystack Integration Balance:');
        try {
          const paystackBalance = await paystackService.checkBalance();
          const integrationBalance = paystackBalance[0]?.balance / 100 || 0;
          console.log(`   Paystack Balance: ₦${integrationBalance.toLocaleString()}`);
        } catch (error) {
          console.log(`   Error checking Paystack: ${error.message}`);
        }
      }

      // Get recent audit trail
      const { data: auditTrail } = await supabase
        .from('balance_audit_trail')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(5);

      if (auditTrail && auditTrail.length > 0) {
        console.log('\n📝 Recent Balance Changes:');
        auditTrail.forEach(entry => {
          console.log(`   ${entry.action}: ₦${parseFloat(entry.balance_before).toLocaleString()} → ₦${parseFloat(entry.balance_after).toLocaleString()}`);
          console.log(`   Date: ${new Date(entry.created_at).toLocaleString()}`);
        });
      }

      return {
        user,
        currentBalance,
        calculatedBalance,
        difference,
        isBalanced: Math.abs(difference) < 0.01,
        transactions: txnSummary
      };
    } catch (error) {
      console.error('❌ Error checking user balance:', error);
      throw error;
    }
  }

  /**
   * Check all user balances
   */
  async checkAllBalances() {
    try {
      console.log('\n🔍 Checking all user balances...\n');

      const { data: users } = await supabase
        .from('users')
        .select('id, first_name, last_name, email, wallet_balance')
        .order('created_at', { ascending: false });

      const results = {
        total: users.length,
        balanced: 0,
        mismatched: 0,
        issues: []
      };

      for (const user of users) {
        const check = await this.checkUserBalance(user.id);
        
        if (check.isBalanced) {
          results.balanced++;
        } else {
          results.mismatched++;
          results.issues.push({
            userId: user.id,
            name: `${user.first_name} ${user.last_name}`,
            email: user.email,
            difference: check.difference
          });
        }

        console.log('\n' + '='.repeat(60) + '\n');
      }

      console.log('\n📊 OVERALL SUMMARY:');
      console.log(`   Total Users: ${results.total}`);
      console.log(`   Balanced: ${results.balanced} ✅`);
      console.log(`   Mismatched: ${results.mismatched} ⚠️`);

      if (results.issues.length > 0) {
        console.log('\n⚠️ USERS WITH BALANCE ISSUES:');
        results.issues.forEach(issue => {
          console.log(`   ${issue.name} (${issue.email}): ${issue.difference > 0 ? '+' : ''}₦${issue.difference.toLocaleString()}`);
        });
      }

      return results;
    } catch (error) {
      console.error('❌ Error checking all balances:', error);
      throw error;
    }
  }

  /**
   * Reconcile user balance with Paystack
   */
  async reconcileWithPaystack(userId) {
    try {
      console.log(`\n🔄 Reconciling balance with Paystack for user: ${userId}\n`);

      const { data: user } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      if (!user.paystack_customer_code) {
        throw new Error('User does not have a Paystack customer code');
      }

      // Get Paystack transactions
      const paystackTransactions = await paystackService.listTransactions(
        user.paystack_customer_code
      );

      console.log(`📋 Found ${paystackTransactions.length} Paystack transactions`);

      // Get database transactions
      const { data: dbTransactions } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', userId)
        .eq('type', 'credit');

      console.log(`📋 Found ${dbTransactions.length} database credit transactions`);

      // Find missing transactions
      const missingInDb = [];
      for (const psTxn of paystackTransactions) {
        const exists = dbTransactions.find(db => db.reference === psTxn.reference);
        if (!exists && psTxn.status === 'success') {
          missingInDb.push(psTxn);
        }
      }

      if (missingInDb.length > 0) {
        console.log(`\n⚠️ Found ${missingInDb.length} missing transactions in database:`);
        missingInDb.forEach(txn => {
          console.log(`   Reference: ${txn.reference}, Amount: ₦${(txn.amount / 100).toLocaleString()}`);
        });
      } else {
        console.log('\n✅ All Paystack transactions are recorded in database');
      }

      return {
        paystackCount: paystackTransactions.length,
        databaseCount: dbTransactions.length,
        missingInDb
      };
    } catch (error) {
      console.error('❌ Error reconciling with Paystack:', error);
      throw error;
    }
  }

  /**
   * Get platform-wide balance summary
   */
  async getPlatformSummary() {
    try {
      console.log('\n📊 PLATFORM BALANCE SUMMARY\n');

      const { data: summary } = await supabase
        .rpc('get_balance_summary');

      if (summary && summary.length > 0) {
        const s = summary[0];
        console.log('👥 User Statistics:');
        console.log(`   Total Users: ${s.total_users}`);
        console.log(`   Users with Balance: ${s.users_with_balance}`);
        
        console.log('\n💰 Balance Statistics:');
        console.log(`   Total Platform Balance: ₦${parseFloat(s.total_wallet_balance).toLocaleString()}`);
        
        console.log('\n🔍 Reconciliation Status:');
        console.log(`   Unreconciled Transactions: ${s.unreconciled_transactions}`);
        console.log(`   Failed Fundings: ${s.failed_fundings}`);
        
        if (s.last_reconciliation) {
          console.log(`   Last Reconciliation: ${new Date(s.last_reconciliation).toLocaleString()}`);
        }
      }

      // Get Paystack integration balance
      console.log('\n💳 Paystack Integration:');
      try {
        const paystackBalance = await paystackService.checkBalance();
        paystackBalance.forEach(bal => {
          console.log(`   ${bal.currency} Balance: ₦${(bal.balance / 100).toLocaleString()}`);
        });
      } catch (error) {
        console.log(`   Error: ${error.message}`);
      }

      // Check for balance mismatches
      const { data: mismatches } = await supabase
        .from('balance_verification_summary')
        .select('*')
        .eq('balance_verified', false);

      if (mismatches && mismatches.length > 0) {
        console.log(`\n⚠️ Users with Balance Discrepancies: ${mismatches.length}`);
        mismatches.forEach(user => {
          console.log(`   ${user.first_name} ${user.last_name}: Diff = ₦${parseFloat(user.balance_difference).toLocaleString()}`);
        });
      }

      return summary;
    } catch (error) {
      console.error('❌ Error getting platform summary:', error);
      throw error;
    }
  }

  /**
   * Fix balance discrepancy for a user
   */
  async fixUserBalance(userId, reason = 'Manual reconciliation') {
    try {
      console.log(`\n🔧 Fixing balance for user: ${userId}\n`);

      // First check the balance
      const check = await this.checkUserBalance(userId);

      if (check.isBalanced) {
        console.log('✅ Balance is already correct. No action needed.');
        return;
      }

      console.log(`\n⚠️ Balance mismatch detected: ₦${check.difference.toLocaleString()}`);
      console.log('Do you want to adjust the wallet balance to match transactions? (yes/no)');

      // In production, you'd want to confirm this action
      // For now, we'll just log what would happen
      console.log(`\n🔧 Would update wallet balance from ₦${check.currentBalance} to ₦${check.calculatedBalance}`);
      console.log('💡 To actually perform this update, uncomment the code below:');

      /*
      const { error } = await supabase
        .from('users')
        .update({ 
          wallet_balance: check.calculatedBalance,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);

      if (error) throw error;

      // Log the adjustment
      await supabase
        .from('balance_audit_trail')
        .insert([{
          user_id: userId,
          action: 'ADJUSTMENT',
          balance_before: check.currentBalance,
          balance_after: check.calculatedBalance,
          amount: Math.abs(check.difference),
          description: reason,
          performed_by: 'ADMIN_SCRIPT'
        }]);

      console.log('✅ Balance adjusted successfully!');
      */

      return check;
    } catch (error) {
      console.error('❌ Error fixing balance:', error);
      throw error;
    }
  }
}

// CLI Interface
const checker = new BalanceChecker();

const command = process.argv[2];
const userId = process.argv[3];

switch (command) {
  case 'check':
    if (userId) {
      checker.checkUserBalance(userId);
    } else {
      console.error('❌ Please provide a user ID: node balanceChecker.js check <userId>');
    }
    break;

  case 'check-all':
    checker.checkAllBalances();
    break;

  case 'reconcile':
    if (userId) {
      checker.reconcileWithPaystack(userId);
    } else {
      console.error('❌ Please provide a user ID: node balanceChecker.js reconcile <userId>');
    }
    break;

  case 'summary':
    checker.getPlatformSummary();
    break;

  case 'fix':
    if (userId) {
      checker.fixUserBalance(userId);
    } else {
      console.error('❌ Please provide a user ID: node balanceChecker.js fix <userId>');
    }
    break;

  default:
    console.log(`
📊 Balance Checker & Reconciliation Utility

Usage:
  node balanceChecker.js <command> [options]

Commands:
  check <userId>      - Check balance for a specific user
  check-all           - Check balances for all users
  reconcile <userId>  - Reconcile user balance with Paystack
  summary             - Get platform-wide balance summary
  fix <userId>        - Fix balance discrepancy for a user

Examples:
  node balanceChecker.js check 123e4567-e89b-12d3-a456-426614174000
  node balanceChecker.js check-all
  node balanceChecker.js summary
    `);
}

export default BalanceChecker;