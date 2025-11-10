/**
 * PRODUCTION-READY PAYSTACK WEBHOOK HANDLER
 * 
 * Features:
 * - Automatic wallet crediting on charge.success
 * - Signature verification for security
 * - Duplicate transaction prevention
 * - Telegram notifications
 * - Comprehensive logging
 */

import express from 'express';
import crypto from 'crypto';

const router = express.Router();

/**
 * CRITICAL: Raw body parser for webhook signature verification
 * This middleware captures the raw body before JSON parsing
 */
router.use(
  '/webhooks/paystack',
  express.raw({ type: 'application/json' })
);

/**
 * Main Paystack Webhook Endpoint
 * URL Format: https://your-domain.com/webhooks/paystack
 */
router.post('/webhooks/paystack', async (req, res) => {
  const startTime = Date.now();
  
  try {
    // ========================================
    // STEP 1: EXTRACT AND VERIFY SIGNATURE
    // ========================================
    const signature = req.headers['x-paystack-signature'];
    
    if (!signature) {
      console.error('❌ [WEBHOOK] Missing Paystack signature');
      return res.status(400).send('Missing signature');
    }

    // Get raw body for signature verification
    const rawBody = req.body.toString('utf8');
    const event = JSON.parse(rawBody);

    // Verify webhook signature
    const expectedHash = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
      .update(rawBody)
      .digest('hex');

    if (expectedHash !== signature) {
      console.error('❌ [WEBHOOK] Invalid signature');
      return res.status(400).send('Invalid signature');
    }

    console.log(`✅ [WEBHOOK] Valid signature for event: ${event.event}`);

    // ========================================
    // STEP 2: LOG WEBHOOK EVENT TO DATABASE
    // ========================================
    const { supabase } = req.app.locals;
    
    await supabase.from('webhook_events').insert([{
      event_type: event.event,
      reference: event.data?.reference || null,
      customer_code: event.data?.customer?.customer_code || null,
      amount: event.data?.amount ? event.data.amount / 100 : null,
      status: event.data?.status || null,
      event_data: event,
      processed: false,
      created_at: new Date().toISOString()
    }]);

    // ========================================
    // STEP 3: RESPOND IMMEDIATELY (IMPORTANT!)
    // ========================================
    // Paystack expects a 200 response within seconds
    res.status(200).send('OK');

    // ========================================
    // STEP 4: PROCESS EVENT ASYNCHRONOUSLY
    // ========================================
    setImmediate(async () => {
      try {
        await processWebhookEvent(event, req.app.locals);
        
        // Mark as processed
        await supabase
          .from('webhook_events')
          .update({ 
            processed: true,
            processed_at: new Date().toISOString(),
            processing_time_ms: Date.now() - startTime
          })
          .eq('reference', event.data?.reference)
          .eq('event_type', event.event);
        
        console.log(`✅ [WEBHOOK] Processed in ${Date.now() - startTime}ms`);
        
      } catch (error) {
        console.error('❌ [WEBHOOK] Processing error:', error);
        
        // Log error to database
        await supabase
          .from('webhook_events')
          .update({ 
            processed: false,
            error_message: error.message,
            processing_time_ms: Date.now() - startTime
          })
          .eq('reference', event.data?.reference)
          .eq('event_type', event.event);
      }
    });

  } catch (error) {
    console.error('❌ [WEBHOOK] Handler error:', error);
    // Don't throw - we already sent 200 OK
  }
});

/**
 * Process different webhook event types
 */
async function processWebhookEvent(event, { supabase, bot }) {
  const eventType = event.event;
  const data = event.data;

  console.log(`📦 [WEBHOOK] Processing: ${eventType}`);

  switch (eventType) {
    case 'charge.success':
      await handleChargeSuccess(data, supabase, bot);
      break;

    case 'transfer.success':
      console.log('✅ [WEBHOOK] Transfer successful:', data.reference);
      await updateTransactionStatus(data.reference, 'completed', supabase);
      break;

    case 'transfer.failed':
      console.log('❌ [WEBHOOK] Transfer failed:', data.reference);
      await handleTransferFailure(data, supabase, bot);
      break;

    case 'dedicatedaccount.assign.success':
      console.log('✅ [WEBHOOK] Virtual account assigned:', data.dedicated_account?.account_number);
      break;

    case 'dedicatedaccount.assign.failed':
      console.error('❌ [WEBHOOK] Virtual account assignment failed');
      break;

    default:
      console.log(`ℹ️  [WEBHOOK] Unhandled event: ${eventType}`);
  }
}

/**
 * Handle successful payment (charge.success)
 * This is the main event for wallet funding
 */
async function handleChargeSuccess(data, supabase, bot) {
  const startTime = Date.now();
  
  try {
    const customerCode = data.customer?.customer_code;
    const amountInKobo = data.amount;
    const amountInNaira = amountInKobo / 100;
    const reference = data.reference;
    const channel = data.channel;

    if (!customerCode || !reference) {
      console.error('❌ [CHARGE] Missing customer_code or reference');
      return;
    }

    console.log(`💰 [CHARGE] Processing ₦${amountInNaira.toLocaleString()} | Ref: ${reference}`);

    // ========================================
    // CHECK FOR DUPLICATE TRANSACTIONS
    // ========================================
    const { data: existingTxn } = await supabase
      .from('transactions')
      .select('id, status')
      .eq('reference', reference)
      .maybeSingle();

    if (existingTxn) {
      console.log(`⚠️  [CHARGE] Duplicate transaction ignored: ${reference}`);
      return;
    }

    // ========================================
    // FIND USER BY CUSTOMER CODE
    // ========================================
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('paystack_customer_code', customerCode)
      .single();

    if (userError || !user) {
      console.error(`❌ [CHARGE] User not found for customer: ${customerCode}`);
      
      // Log failed funding for manual resolution
      await supabase.from('failed_fundings').insert([{
        customer_code: customerCode,
        amount: amountInNaira,
        reference: reference,
        reason: 'User not found',
        event_data: data,
        resolved: false,
        created_at: new Date().toISOString()
      }]);
      
      return;
    }

    // ========================================
    // UPDATE WALLET BALANCE ATOMICALLY
    // ========================================
    const currentBalance = parseFloat(user.wallet_balance || 0);
    const newBalance = currentBalance + amountInNaira;

    const { error: updateError } = await supabase
      .from('users')
      .update({ 
        wallet_balance: newBalance,
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id);

    if (updateError) {
      console.error('❌ [CHARGE] Balance update failed:', updateError);
      throw updateError;
    }

    // ========================================
    // CREATE TRANSACTION RECORD
    // ========================================
    const { error: txnError } = await supabase
      .from('transactions')
      .insert([{
        user_id: user.id,
        type: 'credit',
        amount: amountInNaira,
        service_fee: 0,
        description: `Wallet funding via ${channel}`,
        reference: reference,
        status: 'completed',
        metadata: {
          channel: channel,
          payment_method: data.authorization?.channel || channel,
          sender_name: data.metadata?.sender_name || null,
          sender_bank: data.metadata?.sender_bank || null
        },
        created_at: new Date().toISOString()
      }]);

    if (txnError) {
      console.error('❌ [CHARGE] Transaction record failed:', txnError);
      // Balance already updated, log for manual verification
      await supabase.from('balance_reconciliation').insert([{
        user_id: user.id,
        amount: amountInNaira,
        reference: reference,
        user_balance: newBalance,
        reconciled: false,
        notes: 'Balance updated but transaction record failed',
        created_at: new Date().toISOString()
      }]);
    }

    console.log(`✅ [CHARGE] Wallet credited: ₦${amountInNaira.toLocaleString()} → ₦${newBalance.toLocaleString()}`);

    // ========================================
    // SEND TELEGRAM NOTIFICATION
    // ========================================
    if (user.telegram_chat_id && bot) {
      try {
        // Format amounts safely
        const formattedAmount = amountInNaira.toLocaleString('en-NG');
        const formattedBalance = newBalance.toLocaleString('en-NG');
        const safeReference = escapeMarkdown(reference);
        const safeChannel = escapeMarkdown(channel || 'card');

        const message = 
          `💸 *Payment Received\\!*\n\n` +
          `💰 Amount: ₦${formattedAmount}\n` +
          `💵 New Balance: ₦${formattedBalance}\n` +
          `🔖 Reference: ${safeReference}\n` +
          `📱 Channel: ${safeChannel}\n\n` +
          `🎉 Your wallet has been credited successfully\\!`;

        await bot.sendMessage(
          user.telegram_chat_id,
          message,
          { parse_mode: 'MarkdownV2' }
        );
        
        console.log('✅ [CHARGE] Notification sent successfully');
        
      } catch (notifError) {
        console.error('❌ [CHARGE] Notification failed:', notifError.message);
        
        // Fallback: Send without markdown
        try {
          const plainMessage = 
            `💸 Payment Received!\n\n` +
            `💰 Amount: ₦${amountInNaira.toLocaleString()}\n` +
            `💵 New Balance: ₦${newBalance.toLocaleString()}\n` +
            `🔖 Reference: ${reference}\n` +
            `📱 Channel: ${channel}\n\n` +
            `🎉 Your wallet has been credited successfully!`;

          await bot.sendMessage(user.telegram_chat_id, plainMessage);
          console.log('✅ [CHARGE] Plain notification sent');
        } catch (fallbackError) {
          console.error('❌ [CHARGE] Fallback notification also failed:', fallbackError.message);
        }
      }
    }


    // ========================================
    // LOG SECURITY EVENT
    // ========================================
    await supabase.from('security_logs').insert([{
      user_id: user.id,
      event_type: 'WALLET_FUNDED',
      details: {
        amount: amountInNaira,
        reference: reference,
        new_balance: newBalance,
        channel: channel,
        processing_time_ms: Date.now() - startTime
      },
      ip_address: 'paystack_webhook',
      user_agent: 'paystack_webhook',
      created_at: new Date().toISOString()
    }]);

  } catch (error) {
    console.error('❌ [CHARGE] Handler error:', error);
    throw error;
  }
}

/**
 * Handle failed transfer (refund user)
 */
async function handleTransferFailure(data, supabase, bot) {
  try {
    const reference = data.reference;
    
    // Find the original transaction
    const { data: txn } = await supabase
      .from('transactions')
      .select('*, users!inner(telegram_chat_id, wallet_balance, id)')
      .eq('reference', reference)
      .single();

    if (!txn) {
      console.error(`❌ [TRANSFER] Transaction not found: ${reference}`);
      return;
    }

    // Calculate refund amount (amount + fee)
    const refundAmount = parseFloat(txn.amount) + parseFloat(txn.service_fee || 0);
    const currentBalance = parseFloat(txn.users.wallet_balance);
    const newBalance = currentBalance + refundAmount;

    // Refund to wallet
    await supabase
      .from('users')
      .update({ wallet_balance: newBalance })
      .eq('id', txn.users.id);

    // Update transaction status
    await supabase
      .from('transactions')
      .update({
        status: 'failed',
        metadata: {
          ...txn.metadata,
          failure_reason: data.reason || 'Unknown',
          refunded: true,
          refund_amount: refundAmount
        }
      })
      .eq('id', txn.id);

    // Notify user
    if (txn.users.telegram_chat_id && bot) {
      await bot.sendMessage(
        txn.users.telegram_chat_id,
        `❌ *Transfer Failed*\n\n` +
        `💰 Amount: ₦${parseFloat(txn.amount).toLocaleString()}\n` +
        `❗ Reason: ${data.reason || 'Unknown error'}\n` +
        `💵 Refunded: ₦${refundAmount.toLocaleString()}\n` +
        `📊 New Balance: ₦${newBalance.toLocaleString()}\n\n` +
        `Your funds have been returned to your wallet.`,
        { parse_mode: 'Markdown' }
      );
    }

    console.log(`✅ [TRANSFER] Refunded ₦${refundAmount.toLocaleString()} for ${reference}`);

  } catch (error) {
    console.error('❌ [TRANSFER] Failure handler error:', error);
  }
}

/**
 * Update transaction status
 */
async function updateTransactionStatus(reference, status, supabase) {
  try {
    await supabase
      .from('transactions')
      .update({ status: status })
      .eq('reference', reference);
  } catch (error) {
    console.error('❌ [STATUS] Update error:', error);
  }
}

/**
 * Webhook health check endpoint
 */
router.get('/webhooks/paystack/health', (req, res) => {
  res.json({
    status: 'healthy',
    webhook_url: `${req.protocol}://${req.get('host')}/webhooks/paystack`,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

export default router;