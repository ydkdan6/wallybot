import TelegramBot from 'node-telegram-bot-api';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import bcrypt from 'bcryptjs';
import cron from 'node-cron';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Services - you'll need to convert these to ES modules too
import PaystackService from './services/PaystackService.js';
import ReceiptService from './services/ReceiptService.js';
import ReportService from './services/ReportService.js';
import OCRService from './services/OCRService.js';
import NLPService from './services/NLPService.js';

// Initialize services
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const paystackService = new PaystackService(process.env.PAYSTACK_SECRET_KEY);
const receiptService = new ReceiptService();
const reportService = new ReportService(supabase);
const ocrService = new OCRService(process.env.OCR_API_KEY);
const nlpService = new NLPService(genAI);

// User sessions for temporary data storage
const userSessions = new Map();

// Welcome message when user starts the bot
bot.onText(/\/start(.*)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = match[1]?.trim();

  try {
    if (userId) {
      // Link user account with Telegram chat ID
      const { data: user, error } = await supabase
        .from('users')
        .update({ telegram_chat_id: chatId.toString() })
        .eq('id', userId)
        .select()
        .single();

      if (error) throw error;

      if (user) {
        // Create Paystack customer and virtual account
        await setupUserWallet(user);
        
        await bot.sendMessage(chatId, `🎉 Welcome to QuickWallet, ${user.first_name}!\n\n` +
          `Your account has been successfully linked. I'm your AI-powered financial assistant.\n\n` +
          `✨ What I can help you with:\n` +
          `💰 Fund your wallet\n` +
          `💸 Send money to friends\n` +
          `📊 Check transaction history\n` +
          `📱 Account management\n` +
          `🤖 Natural conversation about your finances\n\n` +
          `Just talk to me naturally! For example:\n` +
          `"I want to send 5000 to my friend"\n` +
          `"Fund my wallet with 10000"\n` +
          `"Show me my transaction history"\n\n` +
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

// Setup user wallet with Paystack
async function setupUserWallet(user) {
  try {
    // Create Paystack customer
    const customerData = await paystackService.createCustomer({
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      phone: user.phone_number
    });

    // Create dedicated virtual account
    const virtualAccount = await paystackService.createDedicatedAccount(
      customerData.customer_code
    );

    // Update user record with Paystack data
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

// Handle all text messages with NLP
bot.on('message', async (msg) => {
  if (msg.text?.startsWith('/')) return; // Skip commands
  
  const chatId = msg.chat.id;
  const text = msg.text;

  try {
    // Get user from database
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

    // Process message with NLP
    const intent = await nlpService.processMessage(text);
    await handleUserIntent(chatId, user, intent, text);

  } catch (error) {
    console.error('Message processing error:', error);
    await bot.sendMessage(chatId, 
      '🤖 Sorry, I had trouble understanding that. Could you rephrase? ' +
      'I can help you with wallet funding, transfers, balance checks, and transaction history.');
  }
});

// Handle different user intents
async function handleUserIntent(chatId, user, intent, originalMessage) {
  switch (intent.type) {
    case 'FUND_WALLET':
      await handleFundWallet(chatId, user, intent.amount);
      break;
    
    case 'SEND_MONEY':
      await handleSendMoney(chatId, user, intent);
      break;
    
    case 'CHECK_BALANCE':
      await handleCheckBalance(chatId, user);
      break;
    
    case 'TRANSACTION_HISTORY':
      await handleTransactionHistory(chatId, user);
      break;
    
    case 'GENERAL_CHAT':
      await handleGeneralChat(chatId, originalMessage);
      break;
    
    default:
      await bot.sendMessage(chatId, 
        "I'm here to help! You can:\n" +
        "💰 Fund your wallet\n" +
        "💸 Send money\n" +
        "📊 Check balance\n" +
        "📱 View transaction history\n\n" +
        "What would you like to do?");
  }
}

// Handle wallet funding
async function handleFundWallet(chatId, user, amount) {
  try {
    if (!user.virtual_account_number) {
      await bot.sendMessage(chatId, '⚠️ Your virtual account is being set up. Please try again in a moment.');
      return;
    }

    const message = amount 
      ? `💰 To fund your wallet with ₦${amount.toLocaleString()}:\n\n`
      : `💰 To fund your wallet:\n\n`;

    await bot.sendMessage(chatId, 
      message +
      `🏦 Bank: Wema Bank\n` +
      `🔢 Account Number: ${user.virtual_account_number}\n` +
      `📛 Account Name: ${user.virtual_account_name}\n\n` +
      `✨ Your wallet will be credited automatically after payment!\n` +
      `📱 I'll notify you immediately when the funding is successful.`);
    
  } catch (error) {
    console.error('Fund wallet error:', error);
    await bot.sendMessage(chatId, '❌ Unable to retrieve funding details. Please try again.');
  }
}

// Handle money transfer
async function handleSendMoney(chatId, user, intent) {
  try {
    // Check if user has sufficient balance
    if (user.wallet_balance < (intent.amount + 10)) {
      await bot.sendMessage(chatId, 
        `❌ Insufficient balance!\n\n` +
        `💰 Current Balance: ₦${user.wallet_balance.toLocaleString()}\n` +
        `💸 Required: ₦${(intent.amount + 10).toLocaleString()} (including ₦10 service fee)\n\n` +
        `Please fund your wallet first.`);
      return;
    }

    // Store transaction session
    const sessionId = uuidv4();
    userSessions.set(chatId, {
      type: 'SEND_MONEY',
      sessionId,
      amount: intent.amount,
      recipient_account: intent.account_number,
      recipient_name: intent.recipient_name
    });

    await bot.sendMessage(chatId, 
      `💸 Transfer Details:\n\n` +
      `💰 Amount: ₦${intent.amount.toLocaleString()}\n` +
      `🏦 To: ${intent.account_number}\n` +
      `👤 Name: ${intent.recipient_name || 'Unknown'}\n` +
      `💳 Service Fee: ₦10\n` +
      `📊 Total: ₦${(intent.amount + 10).toLocaleString()}\n\n` +
      `🔐 Please enter your 4-digit transaction PIN to confirm:`);

  } catch (error) {
    console.error('Send money error:', error);
    await bot.sendMessage(chatId, '❌ Transaction failed. Please try again.');
  }
}

// Handle PIN verification for transactions
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // Check if user has an active transaction session
  const session = userSessions.get(chatId);
  if (!session || !/^\d{4}$/.test(text)) return;

  try {
    // Get user and verify PIN
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_chat_id', chatId.toString())
      .single();

    const pinValid = await bcrypt.compare(text, user.transaction_pin);
    if (!pinValid) {
      await bot.sendMessage(chatId, '❌ Invalid PIN. Transaction cancelled.');
      userSessions.delete(chatId);
      return;
    }

    // Process the transaction
    await processTransaction(chatId, user, session);
    userSessions.delete(chatId);

  } catch (error) {
    console.error('PIN verification error:', error);
    await bot.sendMessage(chatId, '❌ Transaction failed. Please try again.');
    userSessions.delete(chatId);
  }
});

// Process confirmed transaction
async function processTransaction(chatId, user, session) {
  try {
    const { amount, recipient_account, recipient_name } = session;
    const serviceFee = 10;
    const totalAmount = amount + serviceFee;
    const reference = `TXN_${Date.now()}_${uuidv4().substr(0, 8)}`;

    // Deduct from user's wallet
    const newBalance = parseFloat(user.wallet_balance) - totalAmount;
    
    // Update wallet balance
    await supabase
      .from('users')
      .update({ wallet_balance: newBalance })
      .eq('id', user.id);

    // Record transaction
    const { data: transaction } = await supabase
      .from('transactions')
      .insert([{
        user_id: user.id,
        type: 'transfer',
        amount: amount,
        service_fee: serviceFee,
        recipient_account,
        recipient_name,
        description: `Transfer to ${recipient_account}`,
        reference,
        status: 'completed'
      }])
      .select()
      .single();

    // Generate receipt
    const receiptPath = await receiptService.generateReceipt(transaction, user);
    
    // Send success message with receipt
    await bot.sendMessage(chatId, 
      `✅ Transfer Successful!\n\n` +
      `💰 Amount: ₦${amount.toLocaleString()}\n` +
      `🏦 To: ${recipient_account}\n` +
      `👤 Name: ${recipient_name}\n` +
      `🔖 Reference: ${reference}\n` +
      `📊 New Balance: ₦${newBalance.toLocaleString()}\n\n` +
      `📄 Receipt generated successfully!`);

    // Send receipt as document
    await bot.sendDocument(chatId, receiptPath, {
      caption: '📄 Transaction Receipt'
    });

    // Clean up receipt file
    fs.unlinkSync(receiptPath);

  } catch (error) {
    console.error('Transaction processing error:', error);
    await bot.sendMessage(chatId, '❌ Transaction failed. Please contact support.');
  }
}

// Handle balance check
async function handleCheckBalance(chatId, user) {
  try {
    await bot.sendMessage(chatId, 
      `💰 Wallet Balance\n\n` +
      `💵 Available: ₦${parseFloat(user.wallet_balance).toLocaleString()}\n` +
      `🏦 Account: ${user.virtual_account_number}\n\n` +
      `💡 You can fund your wallet anytime by transferring to your virtual account!`);
  } catch (error) {
    console.error('Balance check error:', error);
    await bot.sendMessage(chatId, '❌ Unable to retrieve balance. Please try again.');
  }
}

// Handle transaction history
async function handleTransactionHistory(chatId, user) {
  try {
    const { data: transactions } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10);

    if (!transactions || transactions.length === 0) {
      await bot.sendMessage(chatId, '📭 No transactions found.');
      return;
    }

    let message = '📊 Recent Transactions\n\n';
    transactions.forEach((txn, index) => {
      const date = new Date(txn.created_at).toLocaleDateString();
      const type = txn.type === 'credit' ? '💵' : '💸';
      message += `${type} ₦${parseFloat(txn.amount).toLocaleString()}\n`;
      message += `   ${txn.description}\n`;
      message += `   ${date} • ${txn.status}\n\n`;
    });

    await bot.sendMessage(chatId, message);
  } catch (error) {
    console.error('Transaction history error:', error);
    await bot.sendMessage(chatId, '❌ Unable to retrieve transaction history.');
  }
}

// Handle general chat with AI
async function handleGeneralChat(chatId, message) {
  try {
    const response = await nlpService.generateResponse(message);
    await bot.sendMessage(chatId, response);
  } catch (error) {
    console.error('General chat error:', error);
    await bot.sendMessage(chatId, 
      "I'm here to help with your wallet! You can fund your wallet, send money, check balance, or view transaction history. 😊");
  }
}

// Handle photo uploads for OCR
bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    await bot.sendMessage(chatId, '📷 Processing image... Please wait.');
    
    // Get the highest resolution photo
    const photo = msg.photo[msg.photo.length - 1];
    const fileLink = await bot.getFileLink(photo.file_id);
    
    // Process with OCR
    const extractedText = await ocrService.extractText(fileLink);
    const accountInfo = ocrService.extractAccountInfo(extractedText);
    
    if (accountInfo.accountNumber) {
      await bot.sendMessage(chatId, 
        `🔍 Account Details Found:\n\n` +
        `🔢 Account Number: ${accountInfo.accountNumber}\n` +
        `🏦 Bank: ${accountInfo.bankName || 'Unknown'}\n\n` +
        `💬 Would you like to send money to this account? Just tell me the amount!`);
    } else {
      await bot.sendMessage(chatId, 
        `❌ No account number found in the image.\n` +
        `📝 Please ensure the image clearly shows an account number.`);
    }
    
  } catch (error) {
    console.error('OCR processing error:', error);
    await bot.sendMessage(chatId, '❌ Failed to process image. Please try again.');
  }
});

// Monthly report generation (runs on last day of month)
cron.schedule('0 0 28-31 * *', async () => {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  // Check if tomorrow is the first day of next month
  if (tomorrow.getDate() === 1) {
    console.log('Generating monthly reports...');
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
          `📊 Transactions: ${report.transaction_count}\n\n` +
          `💡 Financial Advice:\n${advice}`);
          
      } catch (error) {
        console.error(`Error generating report for user ${user.id}:`, error);
      }
    }
  } catch (error) {
    console.error('Monthly report generation error:', error);
  }
}

console.log('🤖 Telegram bot started successfully!');

export { bot, supabase };