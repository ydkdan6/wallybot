// Load environment variables
import dotenv from 'dotenv';
dotenv.config();

import TelegramBot from 'node-telegram-bot-api';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import cron from 'node-cron';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Services
import PaystackService from './services/PaystackService.js';
import ReceiptService from './services/ReceiptService.js';
import ReportService from './services/ReportService.js';
import OCRService from './services/OCRService.js';
import EnhancedNLPService from './services/EnhancedNLPService.js';
import EnhancedBeneficiaryService from './services/EnhancedBeneficiaryService.js';
import WalletWorkflowService from './services/WalletWorkflowService.js';
import PaystackWebhookHandler from './webhooks/paystackWebhook.js';

// Validate environment variables
const requiredEnvVars = [
  'TELEGRAM_BOT_TOKEN',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'PAYSTACK_SECRET_KEY',
  'GEMINI_API_KEY'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`❌ Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

console.log('✅ All environment variables loaded successfully!');

// Initialize services
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Initialize services in correct order
const paystackService = new PaystackService(process.env.PAYSTACK_SECRET_KEY);
const receiptService = new ReceiptService();
const reportService = new ReportService(supabase);
const ocrService = new OCRService(process.env.OCR_API_KEY, paystackService);
const nlpService = new EnhancedNLPService(genAI);
const beneficiaryService = new EnhancedBeneficiaryService(paystackService, supabase);
const workflowService = new WalletWorkflowService(nlpService, ocrService, paystackService, beneficiaryService);

// ============= EXPRESS APP SETUP =============
const app = express();

// CRITICAL: Raw body parser for webhook MUST come before JSON parser
app.use('/webhooks/paystack', express.raw({ type: 'application/json' }));

// Standard JSON parser for other routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Make services available to webhook handler
app.locals = { supabase, bot, paystackService };

// Set port from environment or default
const PORT = process.env.PORT || 3000;

// Start Express server
const server = app.listen(PORT, () => {
  console.log('🌐 Express server running on port', PORT);
  console.log(`📡 Webhook URL: http://localhost:${PORT}/webhooks/paystack`);
  console.log(`\n🔗 For local testing with ngrok:`);
  console.log(`   1. Run: ngrok http ${PORT}`);
  console.log(`   2. Copy the https URL (e.g., https://abc123.ngrok-free.app)`);
  console.log(`   3. Use: https://YOUR-NGROK-URL.ngrok-free.app/webhooks/paystack`);
  console.log(`   4. Add to Paystack Dashboard → Settings → Webhooks\n`);
});

// ============= MOUNT WEBHOOK HANDLER =============
app.use('', PaystackWebhookHandler);

// ============= ADMIN MONITORING ENDPOINTS =============

// Webhook statistics
app.get('/admin/webhook/stats', async (req, res) => {
  try {
    if (process.env.ADMIN_SECRET_KEY) {
      const authHeader = req.headers.authorization;
      if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_SECRET_KEY}`) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    const { data: webhookStats } = await supabase
      .from('webhook_events')
      .select('event_type, processed, created_at')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    const { data: failedFundings } = await supabase
      .from('failed_fundings')
      .select('*')
      .eq('resolved', false)
      .order('created_at', { ascending: false })
      .limit(10);

    const stats = {
      last_24_hours: {
        total_events: webhookStats?.length || 0,
        processed: webhookStats?.filter(e => e.processed).length || 0,
        pending: webhookStats?.filter(e => !e.processed).length || 0,
        event_types: {}
      },
      failed_fundings: {
        count: failedFundings?.length || 0,
        items: failedFundings || []
      }
    };

    webhookStats?.forEach(event => {
      if (!stats.last_24_hours.event_types[event.event_type]) {
        stats.last_24_hours.event_types[event.event_type] = 0;
      }
      stats.last_24_hours.event_types[event.event_type]++;
    });

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      stats
    });
  } catch (error) {
    console.error('Webhook stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Manual balance check
app.post('/admin/check-balance/:userId', async (req, res) => {
  try {
    if (process.env.ADMIN_SECRET_KEY) {
      const authHeader = req.headers.authorization;
      if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_SECRET_KEY}`) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    const { userId } = req.params;

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { data: transactions } = await supabase
      .from('transactions')
      .select('type, amount, service_fee, status')
      .eq('user_id', userId)
      .eq('status', 'completed');

    let calculatedBalance = 0;
    const summary = { credits: 0, debits: 0, fees: 0 };

    transactions?.forEach(txn => {
      const amount = parseFloat(txn.amount);
      const fee = parseFloat(txn.service_fee || 0);

      if (txn.type === 'credit') {
        calculatedBalance += amount;
        summary.credits += amount;
      } else {
        calculatedBalance -= (amount + fee);
        summary.debits += amount;
        summary.fees += fee;
      }
    });

    const currentBalance = parseFloat(user.wallet_balance);
    const difference = currentBalance - calculatedBalance;

    res.json({
      success: true,
      user: {
        id: user.id,
        name: `${user.first_name} ${user.last_name}`,
        email: user.email
      },
      balance: {
        current: currentBalance,
        calculated: calculatedBalance,
        difference: difference,
        is_balanced: Math.abs(difference) < 0.01
      },
      summary,
      transaction_count: transactions?.length || 0
    });
  } catch (error) {
    console.error('Balance check error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Retry failed funding
app.post('/admin/retry-funding/:failedFundingId', async (req, res) => {
  try {
    if (process.env.ADMIN_SECRET_KEY) {
      const authHeader = req.headers.authorization;
      if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_SECRET_KEY}`) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    const { failedFundingId } = req.params;

    const { data: failedFunding, error: fetchError } = await supabase
      .from('failed_fundings')
      .select('*')
      .eq('id', failedFundingId)
      .single();

    if (fetchError || !failedFunding) {
      return res.status(404).json({ error: 'Failed funding record not found' });
    }

    if (failedFunding.resolved) {
      return res.status(400).json({ error: 'This funding has already been resolved' });
    }

    let verified = false;
    try {
      const txnDetails = await paystackService.verifyAndGetTransactionDetails(
        failedFunding.reference
      );
      
      if (txnDetails.status === 'success') {
        verified = true;
        
        const { data: user } = await supabase
          .from('users')
          .select('*')
          .eq('id', failedFunding.user_id)
          .single();

        if (user) {
          const currentBalance = parseFloat(user.wallet_balance || 0);
          const newBalance = currentBalance + failedFunding.amount;

          await supabase
            .from('users')
            .update({ wallet_balance: newBalance })
            .eq('id', user.id);

          await supabase
            .from('transactions')
            .insert([{
              user_id: user.id,
              type: 'credit',
              amount: failedFunding.amount,
              service_fee: 0,
              description: 'Wallet funding (retry after failure)',
              reference: failedFunding.reference,
              status: 'completed',
              created_at: new Date().toISOString()
            }]);

          await supabase
            .from('failed_fundings')
            .update({
              resolved: true,
              resolved_at: new Date().toISOString(),
              resolution_notes: 'Manually retried and verified'
            })
            .eq('id', failedFundingId);

          if (user.telegram_chat_id) {
            await bot.sendMessage(
              user.telegram_chat_id,
              `✅ *Wallet Funded Successfully!*\n\n` +
              `💰 Amount: ₦${failedFunding.amount.toLocaleString()}\n` +
              `💵 New Balance: ₦${newBalance.toLocaleString()}\n` +
              `🔖 Reference: ${failedFunding.reference}\n\n` +
              `This was a previously failed funding that has now been processed.`,
              { parse_mode: 'Markdown' }
            );
          }
        }
      }
    } catch (error) {
      console.error('Verification failed:', error);
    }

    res.json({
      success: verified,
      message: verified 
        ? 'Funding retried and processed successfully' 
        : 'Transaction could not be verified with Paystack',
      verified
    });
  } catch (error) {
    console.error('Retry funding error:', error);
    res.status(500).json({ error: error.message });
  }
});

console.log('🔗 Admin endpoints configured:');
console.log('   GET    /admin/webhook/stats - Webhook statistics');
console.log('   POST   /admin/check-balance/:userId - Check user balance');
console.log('   POST   /admin/retry-funding/:failedFundingId - Retry failed funding\n');

// ============= SECURITY & SESSION MANAGEMENT =============

const rateLimiter = new Map();
const failedAttempts = new Map();
const userSessions = new Map();
const conversationContext = new Map();

const SECURITY_CONFIG = {
  MAX_REQUESTS_PER_MINUTE: 20,
  MAX_FAILED_ATTEMPTS: 5,
  LOCKOUT_DURATION: 15 * 60 * 1000,
  TRANSACTION_LIMITS: {
    DAILY_LIMIT: 1000000,
    SINGLE_TRANSACTION: 500000,
    MIN_TRANSACTION: 100
  },
  SESSION_TIMEOUT: 5 * 60 * 1000
};

function checkRateLimit(userId) {
  const now = Date.now();
  const userLimit = rateLimiter.get(userId) || { requests: [], lastReset: now };
  
  if (now - userLimit.lastReset > 60000) {
    userLimit.requests = [];
    userLimit.lastReset = now;
  }
  
  userLimit.requests = userLimit.requests.filter(timestamp => now - timestamp < 60000);
  
  if (userLimit.requests.length >= SECURITY_CONFIG.MAX_REQUESTS_PER_MINUTE) {
    return false;
  }
  
  userLimit.requests.push(now);
  rateLimiter.set(userId, userLimit);
  return true;
}

function isUserLockedOut(userId) {
  const attempts = failedAttempts.get(userId);
  if (!attempts) return false;
  return attempts.count >= SECURITY_CONFIG.MAX_FAILED_ATTEMPTS && Date.now() < attempts.lockUntil;
}

function recordFailedAttempt(userId) {
  const attempts = failedAttempts.get(userId) || { count: 0, lockUntil: 0 };
  attempts.count++;
  if (attempts.count >= SECURITY_CONFIG.MAX_FAILED_ATTEMPTS) {
    attempts.lockUntil = Date.now() + SECURITY_CONFIG.LOCKOUT_DURATION;
  }
  failedAttempts.set(userId, attempts);
}

function clearFailedAttempts(userId) {
  failedAttempts.delete(userId);
}

async function checkTransactionLimits(userId, amount) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const { data: dailyTransactions } = await supabase
      .from('transactions')
      .select('amount')
      .eq('user_id', userId)
      .eq('type', 'transfer')
      .gte('created_at', today.toISOString());
    
    const dailyTotal = dailyTransactions?.reduce((sum, txn) => sum + parseFloat(txn.amount), 0) || 0;
    
    if (amount < SECURITY_CONFIG.TRANSACTION_LIMITS.MIN_TRANSACTION) {
      return { allowed: false, reason: `Minimum transaction amount is ₦${SECURITY_CONFIG.TRANSACTION_LIMITS.MIN_TRANSACTION.toLocaleString()}` };
    }
    
    if (amount > SECURITY_CONFIG.TRANSACTION_LIMITS.SINGLE_TRANSACTION) {
      return { allowed: false, reason: `Maximum single transaction limit is ₦${SECURITY_CONFIG.TRANSACTION_LIMITS.SINGLE_TRANSACTION.toLocaleString()}` };
    }
    
    if (dailyTotal + amount > SECURITY_CONFIG.TRANSACTION_LIMITS.DAILY_LIMIT) {
      return { 
        allowed: false, 
        reason: `Daily transaction limit exceeded. Used: ₦${dailyTotal.toLocaleString()}, Limit: ₦${SECURITY_CONFIG.TRANSACTION_LIMITS.DAILY_LIMIT.toLocaleString()}` 
      };
    }
    
    return { allowed: true };
  } catch (error) {
    console.error('Transaction limit check error:', error);
    return { allowed: false, reason: 'Unable to verify transaction limits' };
  }
}

function cleanupSessions() {
  const now = Date.now();
  for (const [chatId, session] of userSessions.entries()) {
    if (now - session.timestamp > SECURITY_CONFIG.SESSION_TIMEOUT) {
      userSessions.delete(chatId);
    }
  }
  for (const [chatId, context] of conversationContext.entries()) {
    if (now - context.timestamp > SECURITY_CONFIG.SESSION_TIMEOUT) {
      conversationContext.delete(chatId);
    }
  }
}

setInterval(cleanupSessions, 60000);

// ============= TELEGRAM BOT HANDLERS =============

// Welcome message
bot.onText(/\/start(.*)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = match[1]?.trim();

  try {
    if (!checkRateLimit(chatId.toString())) {
      await bot.sendMessage(chatId, '⚠️ Too many requests. Please wait a minute before trying again.');
      return;
    }

    if (userId) {
      const { data: user, error } = await supabase
        .from('users')
        .update({ telegram_chat_id: chatId.toString() })
        .eq('id', userId)
        .select()
        .single();

      if (error) throw error;

      if (user) {
        await setupUserWallet(user);
        
        await bot.sendMessage(chatId, `🎉 Welcome to QuickWallet, ${user.first_name}!\n\n` +
          `Your account has been successfully linked. I'm your AI-powered financial assistant.\n\n` +
          `Wait for few minutes to allow account propagation then your wallet can be funded\n\n` +
          `✨ What I can help you with:\n` +
          `💰 Fund your wallet\n` +
          `💸 Send money to friends & saved contacts\n` +
          `👥 Manage beneficiaries (save frequent contacts)\n` +
          `📊 Check transaction history\n` +
          `📱 Account management\n` +
          `🤖 Natural conversation about your finances\n\n` +
          `Just talk to me naturally! For example:\n` +
          `"Send 5000 to John"\n` +
          `"Add my mom's account 0123456789"\n` +
          `"Fund my wallet with 10000"\n` +
          `"Show my saved contacts"\n\n` +
          `🔐 Security Features:\n` +
          `• Daily limit: ₦${SECURITY_CONFIG.TRANSACTION_LIMITS.DAILY_LIMIT.toLocaleString()}\n` +
          `• Per transaction: ₦${SECURITY_CONFIG.TRANSACTION_LIMITS.SINGLE_TRANSACTION.toLocaleString()}\n` +
          `• PIN protection for all transfers\n\n` +
          `How can I assist you today? 😊`);
      }
    } else {
      await bot.sendMessage(chatId, 
        `👋 Welcome to QuickWallet!\n\n` +
        `To get started, please create an account first at our registration portal.\n` +
        `After registration, you'll be automatically redirected here.\n\n` +
        `🔗 Registration: [Create Account](https://quickwallet-gules.vercel.app)`);
    }
  } catch (error) {
    console.error('Start command error:', error);
    await bot.sendMessage(chatId, '❌ Something went wrong. Please try again later.');
  }
});

// Setup user wallet
async function setupUserWallet(user) {
  try {
    if (user.paystack_customer_code) return;
    
    const customerData = await paystackService.createCustomer({
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      phone: user.phone_number
    });

    const virtualAccount = await paystackService.createDedicatedAccount(
      customerData.customer_code
    );

    await supabase
      .from('users')
      .update({
        paystack_customer_code: customerData.customer_code,
        virtual_account_number: virtualAccount.account_number,
        virtual_account_name: virtualAccount.account_name
      })
      .eq('id', user.id);

    console.log(`Virtual account created for user ${user.id}: ${virtualAccount.account_number}`);
  } catch (error) {
    console.error('Error setting up user wallet:', error);
  }
}

// Enhanced message handler
bot.on('message', async (msg) => {
  if (msg.text?.startsWith('/')) return;
  
  const chatId = msg.chat.id;
  const text = msg.text;

  try {
    if (!checkRateLimit(chatId.toString())) {
      await bot.sendMessage(chatId, '⚠️ Too many requests. Please wait a minute before trying again.');
      return;
    }

    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_chat_id', chatId.toString())
      .single();

    if (!user) {
      await bot.sendMessage(chatId, 
        `❌ Please register first to use this service.\n` +
        `🔗 Registration: [Create Account](https://quickwallet-gules.vercel.app)`);
      return;
    }

    if (isUserLockedOut(user.id)) {
      await bot.sendMessage(chatId, 
        '🔒 Your account is temporarily locked due to multiple failed attempts. Please try again later.');
      return;
    }

    const session = userSessions.get(chatId);
    if (session && /^\d{4}$/.test(text)) {
      await handlePinVerification(chatId, user, text, session);
      return;
    }

    if (session && /^(yes|no|y|n|confirm|cancel)$/i.test(text.trim())) {
      await handleConfirmation(chatId, user, text.toLowerCase().startsWith('y') || text.toLowerCase() === 'confirm', session);
      return;
    }

    const context = conversationContext.get(chatId);
    
    let result;
    if (context && context.lastAction) {
      result = await workflowService.processFollowUp(user.id, text, context);
    } else {
      result = await workflowService.processUserInput(user.id, { message: text });
    }

    await handleWorkflowResult(chatId, user, result, text);

  } catch (error) {
    console.error('Message processing error:', error);
    await bot.sendMessage(chatId, 
      '🤖 Sorry, I had trouble understanding that. Could you rephrase? ' +
      'I can help you with wallet funding, transfers, balance checks, beneficiary management, and transaction history.');
  }
});

// Handle workflow results
async function handleWorkflowResult(chatId, user, result, originalText) {
  try {
    if (!result.success) {
      await bot.sendMessage(chatId, result.message);
      return;
    }

    await bot.sendMessage(chatId, result.message);

    switch (result.action) {
      case 'SHOW_FUNDING_OPTIONS':
        await handleShowFundingOptions(chatId, user, result.data);
        break;
      
      case 'CONFIRM_TRANSFER_TO_BENEFICIARY':
      case 'CONFIRM_NEW_TRANSFER':
        await setupTransferConfirmation(chatId, result);
        break;
      
      case 'CONFIRM_ADD_BENEFICIARY':
        await setupBeneficiaryConfirmation(chatId, result);
        break;
      
      case 'CHECK_BALANCE':
        await handleCheckBalance(chatId, user);
        break;
      
      case 'SHOW_TRANSACTION_HISTORY':
        await handleTransactionHistory(chatId, user);
        break;
      
      case 'REQUEST_TRANSFER_DETAILS':
      case 'REQUEST_AMOUNT':
      case 'REQUEST_BENEFICIARY_DETAILS':
        await setupConversationContext(chatId, result);
        break;
      
      case 'ADD_BENEFICIARY_FROM_IMAGE':
        await setupImageBeneficiaryFlow(chatId, result);
        break;
    }

  } catch (error) {
    console.error('Workflow result handling error:', error);
    await bot.sendMessage(chatId, '❌ An error occurred. Please try again.');
  }
}

// Setup conversation context
function setupConversationContext(chatId, result) {
  conversationContext.set(chatId, {
    lastAction: result.action,
    pendingData: result.data,
    timestamp: Date.now()
  });
}

// Setup transfer confirmation
function setupTransferConfirmation(chatId, result) {
  userSessions.set(chatId, {
    type: 'CONFIRM_TRANSFER',
    action: result.action,
    data: result.data,
    timestamp: Date.now()
  });
}

// Setup beneficiary confirmation
function setupBeneficiaryConfirmation(chatId, result) {
  userSessions.set(chatId, {
    type: 'CONFIRM_BENEFICIARY',
    action: result.action,
    data: result.data,
    timestamp: Date.now()
  });
}

// Setup image beneficiary flow
function setupImageBeneficiaryFlow(chatId, result) {
  conversationContext.set(chatId, {
    lastAction: result.action,
    pendingData: result.data,
    timestamp: Date.now()
  });
}

// Handle confirmation responses
async function handleConfirmation(chatId, user, isConfirmed, session) {
  try {
    if (session.type === 'CONFIRM_TRANSFER') {
      if (isConfirmed) {
        const amount = session.data.amount;
        const limitCheck = await checkTransactionLimits(user.id, amount);
        
        if (!limitCheck.allowed) {
          await bot.sendMessage(chatId, `❌ ${limitCheck.reason}`);
          userSessions.delete(chatId);
          return;
        }

        userSessions.set(chatId, {
          type: 'TRANSFER_PIN',
          data: session.data,
          timestamp: Date.now()
        });
        
        await bot.sendMessage(chatId, 
          `🔐 Please enter your 4-digit transaction PIN to complete the transfer:`);
      } else {
        await bot.sendMessage(chatId, '❌ Transfer cancelled. How else can I help you? 😊');
        userSessions.delete(chatId);
      }
    } else if (session.type === 'CONFIRM_BENEFICIARY') {
      const result = await workflowService.processConfirmation(user.id, isConfirmed, session);
      await bot.sendMessage(chatId, result.message);
      userSessions.delete(chatId);
    }
  } catch (error) {
    console.error('Confirmation handling error:', error);
    await bot.sendMessage(chatId, '❌ An error occurred. Please try again.');
    userSessions.delete(chatId);
  }
}

// PIN verification
async function handlePinVerification(chatId, user, pin, session) {
  try {
    if (session.type !== 'TRANSFER_PIN') return;

    const pinValid = await bcrypt.compare(pin, user.transaction_pin);
    
    if (!pinValid) {
      recordFailedAttempt(user.id);
      const attempts = failedAttempts.get(user.id);
      const remaining = SECURITY_CONFIG.MAX_FAILED_ATTEMPTS - attempts.count;
      
      if (remaining > 0) {
        await bot.sendMessage(chatId, 
          `❌ Invalid PIN. ${remaining} attempts remaining before account lockout.`);
      } else {
        await bot.sendMessage(chatId, 
          '🔒 Account locked due to multiple failed attempts. Please try again in 15 minutes.');
      }
      
      userSessions.delete(chatId);
      return;
    }

    clearFailedAttempts(user.id);
    await processSecureTransfer(chatId, user, session.data);
    userSessions.delete(chatId);

  } catch (error) {
    console.error('PIN verification error:', error);
    await bot.sendMessage(chatId, '❌ Transaction failed. Please try again.');
    userSessions.delete(chatId);
  }
}

// Process secure transfer
async function processSecureTransfer(chatId, user, transferData) {
  try {
    const { amount, beneficiary, account_number } = transferData;
    const serviceFee = 10;
    const totalAmount = amount + serviceFee;

    const currentBalance = parseFloat(user.wallet_balance);
    if (currentBalance < totalAmount) {
      await bot.sendMessage(chatId, 
        `❌ Insufficient balance! Current: ₦${currentBalance.toLocaleString()}, Required: ₦${totalAmount.toLocaleString()}`);
      return;
    }

    const reference = `QW_${Date.now()}_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const newBalance = currentBalance - totalAmount;

    const { data: transaction, error: txnError } = await supabase
      .from('transactions')
      .insert([{
        user_id: user.id,
        type: 'transfer',
        amount: amount,
        service_fee: serviceFee,
        recipient_account: beneficiary?.account_number || account_number,
        recipient_name: beneficiary?.account_name || 'Unknown',
        description: `Transfer to ${beneficiary?.nickname || account_number}`,
        reference,
        status: 'completed'
      }])
      .select()
      .single();

    if (txnError) throw txnError;

    const { error: balanceError } = await supabase
      .from('users')
      .update({ wallet_balance: newBalance })
      .eq('id', user.id);

    if (balanceError) throw balanceError;

    const receiptPath = await receiptService.generateReceipt(transaction, user);
    
    await bot.sendMessage(chatId, 
      `✅ Transfer Successful!\n\n` +
      `💰 Amount: ₦${amount.toLocaleString()}\n` +
      `🏦 To: ${beneficiary?.account_name || 'Recipient'}\n` +
      `📱 Account: ${beneficiary?.account_number || account_number}\n` +
      `🔖 Reference: ${reference}\n` +
      `💳 Service Fee: ₦${serviceFee}\n` +
      `📊 New Balance: ₦${newBalance.toLocaleString()}\n\n` +
      `📄 Receipt generated successfully!`);

    await bot.sendDocument(chatId, receiptPath, {
      caption: '📄 Transaction Receipt'
    });

    fs.unlinkSync(receiptPath);

  } catch (error) {
    console.error('Secure transfer processing error:', error);
    await bot.sendMessage(chatId, '❌ Transaction failed. Please contact support if this persists.');
  }
}

// Show funding options
async function handleShowFundingOptions(chatId, user, data) {
  if (!user.virtual_account_number) {
    await bot.sendMessage(chatId, '⚠️ Your virtual account is being set up. Please try again in a moment.');
    return;
  }

  const message = data.requestedAmount 
    ? `💰 To fund your wallet with ₦${data.requestedAmount.toLocaleString()}:\n\n`
    : `💰 To fund your wallet:\n\n`;

  await bot.sendMessage(chatId, 
    message +
    `🏦 Bank: Paystack-Titan\n` +
    `🔢 Account Number: ${user.virtual_account_number}\n` +
    `📛 Account Name: ${user.virtual_account_name}\n\n` +
    `✨ Your wallet will be credited automatically!\n` +
    `📱 I'll notify you when the funding is successful.\n\n` +
    `💡 You can also fund via:\n` +
    `• Bank app/USSD transfers\n` +
    `• Online banking\n` +
    `• ATM transfers`);
}

// Balance check
async function handleCheckBalance(chatId, user) {
  try {
    const { data: recentTxns } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(3);

    let recentActivity = '';
    if (recentTxns && recentTxns.length > 0) {
      recentActivity = '\n\n📋 Recent Activity:\n';
      recentTxns.forEach(txn => {
        const type = txn.type === 'credit' ? '💵' : '💸';
        const date = new Date(txn.created_at).toLocaleDateString();
        recentActivity += `${type} ₦${parseFloat(txn.amount).toLocaleString()} - ${date}\n`;
      });
    }

    await bot.sendMessage(chatId, 
      `💰 Wallet Balance\n\n` +
      `💵 Available: ₦${parseFloat(user.wallet_balance).toLocaleString()}\n` +
      `🏦 Account: ${user.virtual_account_number}\n` +
      `📊 Daily Limit Remaining: ₦${SECURITY_CONFIG.TRANSACTION_LIMITS.DAILY_LIMIT.toLocaleString()}${recentActivity}\n\n` +
      `💡 You can fund your wallet anytime by transferring to your virtual account!`);
  } catch (error) {
    console.error('Balance check error:', error);
    await bot.sendMessage(chatId, '❌ Unable to retrieve balance. Please try again.');
  }
}

// Transaction history
async function handleTransactionHistory(chatId, user) {
  try {
    const { data: transactions } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(15);

    if (!transactions || transactions.length === 0) {
      await bot.sendMessage(chatId, '📭 No transactions found.\n\n💡 Start by funding your wallet or sending money to friends!');
      return;
    }

    let message = '📊 Transaction History\n\n';
    let totalIn = 0, totalOut = 0;
    
    transactions.forEach((txn) => {
      const date = new Date(txn.created_at).toLocaleDateString();
      const time = new Date(txn.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
      const amount = parseFloat(txn.amount);
      
      if (txn.type === 'credit') {
        totalIn += amount;
        message += `💵 +₦${amount.toLocaleString()}\n`;
      } else {
        totalOut += amount;
        message += `💸 -₦${amount.toLocaleString()}\n`;
      }
      
      message += `   ${txn.description}\n`;
      message += `   ${date} ${time} • ${txn.status}\n\n`;
    });

    message += `📈 Summary:\n`;
    message += `💰 Money In: ₦${totalIn.toLocaleString()}\n`;
    message += `💸 Money Out: ₦${totalOut.toLocaleString()}\n`;
    message += `📊 Net: ₦${(totalIn - totalOut).toLocaleString()}`;

    await bot.sendMessage(chatId, message);
  } catch (error) {
    console.error('Transaction history error:', error);
    await bot.sendMessage(chatId, '❌ Unable to retrieve transaction history.');
  }
}

// Photo handler
bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    if (!checkRateLimit(chatId.toString())) {
      await bot.sendMessage(chatId, '⚠️ Too many requests. Please wait a minute before trying again.');
      return;
    }

    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_chat_id', chatId.toString())
      .single();

    if (!user) {
      await bot.sendMessage(chatId, '❌ Please register first to use this service.');
      return;
    }

    await bot.sendMessage(chatId, '📷 Processing image... Please wait.\n\n⏳ This may take a few seconds...');
    
    const photo = msg.photo[msg.photo.length - 1];
    const file = await bot.getFile(photo.file_id);
    const fileLink = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    
    console.log('📸 Processing image from Telegram:', {
      fileId: photo.file_id,
      fileSize: photo.file_size,
      userId: user.id
    });
    
    const result = await workflowService.processUserInput(user.id, { imageUrl: fileLink });
    
    console.log('✅ Image processing result:', {
      success: result.success,
      action: result.action,
      userId: user.id
    });
    
    await handleWorkflowResult(chatId, user, result, 'image upload');
    
  } catch (error) {
    console.error('❌ Photo processing error:', error);
    await bot.sendMessage(chatId, 
      `❌ Failed to process image.\n\n` +
      `Error: ${error.message}\n\n` +
      `Please try:\n` +
      `• A clearer image with better lighting\n` +
      `• Ensure account details are clearly visible\n` +
      `• Or enter details manually using text`);
  }
});

// Help command
bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    if (!checkRateLimit(chatId.toString())) {
      await bot.sendMessage(chatId, '⚠️ Too many requests. Please wait a minute.');
      return;
    }

    await bot.sendMessage(chatId,
      `🆘 QuickWallet Help\n\n` +
      `💬 **Natural Language Commands:**\n` +
      `Just talk to me naturally! I understand:\n\n` +
      
      `💰 **Wallet Funding:**\n` +
      `• "Fund my wallet with 10000"\n` +
      `• "I want to add money to my wallet"\n` +
      `• "How do I fund my account?"\n\n` +
      
      `💸 **Send Money:**\n` +
      `• "Send 5000 to 0123456789"\n` +
      `• "Transfer 10000 to John" (saved contact)\n` +
      `• "Pay my friend 2000"\n\n` +
      
      `👥 **Manage Beneficiaries:**\n` +
      `• "Add my mom's account 0123456789 GTBank"\n` +
      `• "Save this account as John"\n` +
      `• "Show my saved contacts"\n` +
      `• Send a bank statement photo to auto-add\n\n` +
      
      `📊 **Account Info:**\n` +
      `• "Check my balance"\n` +
      `• "Show transaction history"\n` +
      `• "What's my account number?"\n\n` +
      
      `🔐 **Security Features:**\n` +
      `• PIN protection for all transfers\n` +
      `• Daily limit: ₦${SECURITY_CONFIG.TRANSACTION_LIMITS.DAILY_LIMIT.toLocaleString()}\n` +
      `• Per transaction: ₦${SECURITY_CONFIG.TRANSACTION_LIMITS.SINGLE_TRANSACTION.toLocaleString()}\n` +
      `• Account lockout after failed attempts\n\n` +
      
      `📱 **Other Commands:**\n` +
      `/start - Link your account\n` +
      `/help - Show this help message\n` +
      `/banks - Show supported banks\n\n` +
      
      `❓ **Need Help?**\n` +
      `Just ask me anything about your wallet!`);

  } catch (error) {
    console.error('Help command error:', error);
    await bot.sendMessage(chatId, '❌ Error displaying help. Please try again.');
  }
});

// Show supported banks
bot.onText(/\/banks/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    const banks = ocrService.getSupportedBanks();
    const bankList = banks
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(bank => `• ${bank.name}`)
      .join('\n');
    
    await bot.sendMessage(chatId, 
      `🏦 *Supported Banks* (${banks.length})\n\n${bankList}\n\n` +
      `💡 You can send money to any of these banks!`,
      { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Banks command error:', error);
    await bot.sendMessage(chatId, '❌ Unable to retrieve bank list.');
  }
});

// Test bank command (for debugging)
bot.onText(/\/test_bank (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const bankName = match[1];
  
  try {
    const result = await beneficiaryService.testBankResolution(bankName);
    if (result) {
      await bot.sendMessage(chatId, `✅ Found: ${result.name} (Code: ${result.code})`);
    } else {
      await bot.sendMessage(chatId, `❌ Could not find: "${bankName}"`);
    }
  } catch (error) {
    await bot.sendMessage(chatId, '❌ Error testing bank resolution.');
  }
});

// Admin stats command
bot.onText(/\/admin_stats/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    const { data: user } = await supabase
      .from('users')
      .select('role')
      .eq('telegram_chat_id', chatId.toString())
      .single();

    if (!user || user.role !== 'admin') {
      await bot.sendMessage(chatId, '❌ Unauthorized access.');
      return;
    }

    const stats = {
      activeUsers: rateLimiter.size,
      activeSessions: userSessions.size,
      conversationContexts: conversationContext.size,
      lockedUsers: Array.from(failedAttempts.values()).filter(a => Date.now() < a.lockUntil).length
    };

    await bot.sendMessage(chatId, 
      `📊 System Statistics\n\n` +
      `👥 Active Users: ${stats.activeUsers}\n` +
      `🔄 Active Sessions: ${stats.activeSessions}\n` +
      `💬 Conversation Contexts: ${stats.conversationContexts}\n` +
      `🔒 Locked Users: ${stats.lockedUsers}\n` +
      `⏰ Uptime: ${Math.floor(process.uptime())} seconds`);

  } catch (error) {
    console.error('Admin stats error:', error);
    await bot.sendMessage(chatId, '❌ Error retrieving statistics.');
  }
});

// Monthly report generation
cron.schedule('0 0 28-31 * *', async () => {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  if (tomorrow.getDate() === 1) {
    console.log('📊 Generating monthly reports...');
    await generateMonthlyReports();
  }
});

async function generateMonthlyReports() {
  try {
    const { data: users } = await supabase
      .from('users')
      .select('*')
      .not('telegram_chat_id', 'is', null);

    for (const user of users) {
      try {
        const report = await reportService.generateMonthlyReport(user.id);
        const advice = await reportService.generateFinancialAdvice(report);
        
        await bot.sendMessage(user.telegram_chat_id, 
          `📊 Monthly Financial Report\n\n` +
          `📅 Period: ${report.month}/${report.year}\n` +
          `💵 Money In: ₦${report.total_income.toLocaleString()}\n` +
          `💸 Money Out: ₦${report.total_expenses.toLocaleString()}\n` +
          `📈 Net: ₦${(report.total_income - report.total_expenses).toLocaleString()}\n` +
          `📊 Transactions: ${report.transaction_count}\n` +
          `👥 Beneficiaries Used: ${report.beneficiaries_used || 0}\n\n` +
          `💡 Financial Advice:\n${advice}\n\n` +
          `🎯 Next Month Goals:\n` +
          `• Use saved beneficiaries for faster transfers\n` +
          `• Set up automatic savings targets\n` +
          `• Track spending patterns`);
          
      } catch (error) {
        console.error(`Error generating report for user ${user.id}:`, error);
      }
    }
  } catch (error) {
    console.error('Monthly report generation error:', error);
  }
}

// Security logging
async function logSecurityEvent(userId, eventType, details) {
  try {
    await supabase
      .from('security_logs')
      .insert([{
        user_id: userId,
        event_type: eventType,
        details: JSON.stringify(details),
        ip_address: 'telegram_bot',
        user_agent: 'telegram_bot',
        created_at: new Date().toISOString()
      }]);
  } catch (error) {
    console.error('Security logging error:', error);
  }
}

// Error handler
bot.on('error', (error) => {
  console.error('Telegram bot error:', error);
  if (error.code === 'ETELEGRAM') {
    logSecurityEvent(null, 'BOT_ERROR', { error: error.message });
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down gracefully...');
  
  userSessions.clear();
  conversationContext.clear();
  rateLimiter.clear();
  failedAttempts.clear();
  
  bot.stopPolling();
  
  server.close(() => {
    console.log('🌐 Express server closed');
    process.exit(0);
  });
});

// Health monitoring
setInterval(() => {
  const memUsage = process.memoryUsage();
  console.log(`💾 Memory: RSS ${Math.round(memUsage.rss / 1024 / 1024)}MB, Heap ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
  
  // Cleanup old rate limit entries
  const now = Date.now();
  for (const [userId, userLimit] of rateLimiter.entries()) {
    if (now - userLimit.lastReset > 120000) {
      rateLimiter.delete(userId);
    }
  }
  
  // Cleanup expired lockouts
  for (const [userId, attempts] of failedAttempts.entries()) {
    if (now > attempts.lockUntil && attempts.count >= SECURITY_CONFIG.MAX_FAILED_ATTEMPTS) {
      failedAttempts.delete(userId);
    }
  }
}, 60000);

console.log('🤖 QuickWallet Bot started successfully!');
console.log('🔐 Security features enabled:');
console.log(`   • Rate limiting: ${SECURITY_CONFIG.MAX_REQUESTS_PER_MINUTE} requests/minute`);
console.log(`   • Transaction limits: ₦${SECURITY_CONFIG.TRANSACTION_LIMITS.SINGLE_TRANSACTION.toLocaleString()}/transaction, ₦${SECURITY_CONFIG.TRANSACTION_LIMITS.DAILY_LIMIT.toLocaleString()}/day`);
console.log(`   • Lockout after ${SECURITY_CONFIG.MAX_FAILED_ATTEMPTS} failed attempts`);
console.log('✨ Enhanced features enabled:');
console.log('   • Beneficiary management with OCR');
console.log('   • Conversation context tracking');
console.log('   • Workflow-based processing');
console.log('   • Clean webhook integration\n');

export { bot, supabase, workflowService, beneficiaryService };