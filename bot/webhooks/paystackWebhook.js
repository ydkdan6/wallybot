/**
 * COMPLETE PAYSTACK WEBHOOK INTEGRATION
 * 
 * Webhook URL: https://quickwally.onrender.com/webhooks/paystack
 * 
 * Setup Instructions:
 * 1. Add this URL to your Paystack Dashboard under Settings > Webhooks
 * 2. Ensure PAYSTACK_SECRET_KEY is in your environment variables
 * 3. Deploy to Render and test
 */

import express from "express";
import crypto from "crypto";

const app = express();

/**
 * CRITICAL: Raw body parser for webhook signature verification
 * Must come BEFORE express.json() middleware
 */
app.use('/webhooks/paystack', express.raw({ type: 'application/json' }));

/**
 * Standard JSON parser for other routes
 */
app.use(express.json());

/**
 * Paystack Webhook Endpoint
 * URL: https://quickwally.onrender.com/webhooks/paystack
 */
app.post("/webhooks/paystack", async (req, res) => {
  const startTime = Date.now();
  
  try {
    const signature = req.headers["x-paystack-signature"];
    
    // ✅ Get raw body for signature verification
    const bodyString = req.body.toString('utf8');
    const bodyJson = JSON.parse(bodyString);

    // ✅ Verify webhook signature
    if (!signature) {
      console.error("❌ Missing Paystack signature");
      return res.status(400).send("Missing signature");
    }

    // ✅ Validate signature using raw body
    const expectedHash = crypto
      .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
      .update(bodyString)
      .digest("hex");

    if (expectedHash !== signature) {
      console.error("❌ Invalid Paystack signature");
      await logSecurityEvent(supabase, null, "INVALID_WEBHOOK_SIGNATURE", {
        received_signature: signature.substring(0, 16) + "...",
        ip: req.ip,
        user_agent: req.headers['user-agent']
      });
      return res.status(400).send("Invalid signature");
    }

    console.log(`📥 Valid Paystack Event: ${bodyJson.event} | Ref: ${bodyJson.data?.reference || 'N/A'}`);

    // ✅ Log webhook event for tracking
    await supabase.from('webhook_events').insert([{
      event_type: bodyJson.event,
      reference: bodyJson.data?.reference || null,
      payload: bodyJson,
      processed: false,
      received_at: new Date().toISOString()
    }]);

    // ✅ Respond immediately with 200 OK
    res.status(200).send("OK");

    // ✅ Process in background with timeout protection
    const WEBHOOK_TIMEOUT = 25000; // 25 seconds
    
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Webhook processing timeout')), WEBHOOK_TIMEOUT);
    });

    // Process asynchronously
    setImmediate(async () => {
      try {
        await Promise.race([
          processPaystackEvent(bodyJson, supabase, bot, paystackService),
          timeoutPromise
        ]);
        
        // Mark as processed
        await supabase
          .from('webhook_events')
          .update({ 
            processed: true, 
            processed_at: new Date().toISOString(),
            processing_time_ms: Date.now() - startTime
          })
          .eq('reference', bodyJson.data?.reference)
          .eq('event_type', bodyJson.event);
          
        console.log(`✅ Webhook processed in ${Date.now() - startTime}ms`);
        
      } catch (err) {
        console.error("❌ Async processing error:", err);
        
        await supabase
          .from('webhook_events')
          .update({ 
            processed: false, 
            error_message: err.message,
            last_retry_at: new Date().toISOString(),
            processing_time_ms: Date.now() - startTime
          })
          .eq('reference', bodyJson.data?.reference)
          .eq('event_type', bodyJson.event);
      }
    });

  } catch (error) {
    console.error("❌ Webhook handling error:", error);
    
    // Don't throw - already sent 200 OK
    await logSecurityEvent(supabase, null, "WEBHOOK_HANDLER_ERROR", {
      error: error.message,
      stack: error.stack
    }).catch(err => console.error("Failed to log error:", err));
  }
});

/**
 * Health check endpoint
 */
app.get("/webhooks/paystack", (req, res) => {
  res.status(200).json({ 
    status: "active",
    webhook_url: "https://quickwally.onrender.com/webhooks/paystack",
    message: "Paystack webhook endpoint is ready"
  });
});

/**
 * Process Paystack Events
 */
async function processPaystackEvent(event, supabase, bot, paystackService) {
  const type = event.event;
  const data = event.data;

  console.log("📦 Processing Event:", type);

  switch (type) {
    case "charge.success":
      await handleWalletFunding(data, supabase, bot, paystackService);
      break;

    case "transfer.success":
      await handleTransferSuccess(data, supabase, bot);
      break;

    case "transfer.failed":
      await handleTransferFailure(data, supabase, bot);
      break;

    case "dedicatedaccount.assign.success":
      console.log("✅ Virtual account assigned:", data.dedicated_account?.account_number);
      await logSecurityEvent(supabase, null, "VIRTUAL_ACCOUNT_ASSIGNED", {
        customer_code: data.customer?.customer_code,
        account_number: data.dedicated_account?.account_number,
        bank: data.dedicated_account?.bank?.name
      });
      break;

    case "dedicatedaccount.assign.failed":
      console.error("❌ Virtual account assignment failed:", data);
      await logSecurityEvent(supabase, null, "VIRTUAL_ACCOUNT_ASSIGNMENT_FAILED", {
        customer_code: data.customer?.customer_code,
        reason: data.message
      });
      break;

    case "charge.dispute.create":
      console.log("⚠️ Dispute created:", data.reference);
      await logSecurityEvent(supabase, null, "DISPUTE_CREATED", {
        reference: data.reference,
        amount: data.amount / 100,
        reason: data.reason
      });
      break;

    case "charge.dispute.resolve":
      console.log("✅ Dispute resolved:", data.reference);
      await logSecurityEvent(supabase, null, "DISPUTE_RESOLVED", {
        reference: data.reference,
        resolution: data.resolution
      });
      break;

    default:
      console.log("ℹ️ Unhandled event type:", type);
      await logSecurityEvent(supabase, null, "UNHANDLED_WEBHOOK_EVENT", {
        event_type: type,
        data: data
      });
  }
}

/**
 * Telegram notification with retry
 */
async function sendTelegramWithRetry(bot, chatId, message, options = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await bot.sendMessage(chatId, message, options);
    } catch (err) {
      if (err.response?.statusCode === 429) {
        const retryAfter = err.response.parameters?.retry_after || (i + 1) * 2;
        console.log(`⏳ Rate limited, retrying after ${retryAfter}s...`);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      } else if (i === retries - 1) {
        console.error("❌ Telegram notification failed:", err.message);
        return null;
      } else {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
      }
    }
  }
}

/**
 * Handle wallet funding
 */
async function handleWalletFunding(eventData, supabase, bot, paystackService) {
  const startTime = Date.now();

  try {
    const customerCode = eventData.customer?.customer_code;
    const amount = eventData.amount / 100;
    const reference = eventData.reference;
    
    if (!customerCode || !reference) {
      console.error("❌ Missing required fields");
      return;
    }

    console.log(`💵 Funding: ₦${amount.toLocaleString()} | Ref: ${reference}`);

    // Check for duplicates
    const { data: existing } = await supabase
      .from("transactions")
      .select("id, status")
      .eq("reference", reference)
      .maybeSingle();

    if (existing) {
      console.log("⚠️ Duplicate transaction ignored:", reference);
      return;
    }

    // Verify with Paystack
    const verified = await paystackService.verifyAndGetTransactionDetails(reference);
    if (verified.status !== "success") {
      console.error("❌ Verification failed:", verified.status);
      return;
    }

    // Find user
    const { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("paystack_customer_code", customerCode)
      .single();

    if (!user) {
      console.error("❌ User not found for:", customerCode);
      return;
    }

    // Update wallet atomically
    const { error: rpcError } = await supabase.rpc("process_wallet_funding", {
      uid: user.id,
      amt: amount,
      ref: reference,
      p_desc: `Wallet funding`,
    });

    if (rpcError) {
      if (rpcError.code === '23505') {
        console.log("⚠️ Duplicate prevented by DB");
        return;
      }
      throw rpcError;
    }

    // Get new balance
    const { data: refreshed } = await supabase
      .from("users")
      .select("wallet_balance")
      .eq("id", user.id)
      .single();

    const newBalance = parseFloat(refreshed.wallet_balance);

    // Notify user
    if (user.telegram_chat_id) {
      await sendTelegramWithRetry(
        bot,
        user.telegram_chat_id,
        `💸 *Payment Received!*\n\n` +
        `💰 Amount: ₦${amount.toLocaleString()}\n` +
        `💵 New Balance: ₦${newBalance.toLocaleString()}\n` +
        `🔖 Ref: \`${reference}\`\n\n` +
        `🎉 Your wallet has been credited!`,
        { parse_mode: "Markdown" }
      );
    }

    await logSecurityEvent(supabase, user.id, "WALLET_FUNDED", {
      amount,
      reference,
      new_balance: newBalance,
      processing_time_ms: Date.now() - startTime
    });

    console.log(`✅ Funding complete: ₦${amount.toLocaleString()}`);

  } catch (error) {
    console.error("❌ Wallet funding error:", error);
  }
}

/**
 * Handle transfer success
 */
async function handleTransferSuccess(eventData, supabase, bot) {
  try {
    const { data: tx } = await supabase
      .from("transactions")
      .select("*, users!inner(telegram_chat_id, first_name)")
      .eq("reference", eventData.reference)
      .single();

    if (tx && tx.users.telegram_chat_id) {
      await sendTelegramWithRetry(
        bot,
        tx.users.telegram_chat_id,
        `✅ *Transfer Successful!*\n\n` +
        `💰 Amount: ₦${(eventData.amount / 100).toLocaleString()}\n` +
        `🔖 Ref: ${eventData.reference}\n\n` +
        `🎉 Transaction completed.`,
        { parse_mode: "Markdown" }
      );
      
      await supabase
        .from("transactions")
        .update({ 
          status: "completed",
          metadata: { paystack_confirmation: eventData }
        })
        .eq("id", tx.id);
    }
  } catch (err) {
    console.error("❌ Transfer success error:", err);
  }
}

/**
 * Handle transfer failure
 */
async function handleTransferFailure(eventData, supabase, bot) {
  try {
    const { data: tx } = await supabase
      .from("transactions")
      .select("*, users!inner(telegram_chat_id, wallet_balance, id)")
      .eq("reference", eventData.reference)
      .single();

    if (tx) {
      const refundAmount = parseFloat(tx.amount) + parseFloat(tx.service_fee || 0);
      
      const { data: user } = await supabase
        .from("users")
        .select("wallet_balance")
        .eq("id", tx.users.id)
        .single();
        
      const newBalance = parseFloat(user.wallet_balance) + refundAmount;
      
      await supabase
        .from("users")
        .update({ wallet_balance: newBalance })
        .eq("id", tx.users.id);

      await supabase
        .from("transactions")
        .update({
          status: "failed",
          metadata: {
            failure_reason: eventData.reason,
            refunded: true,
            refund_amount: refundAmount
          }
        })
        .eq("id", tx.id);

      if (tx.users.telegram_chat_id) {
        await sendTelegramWithRetry(
          bot,
          tx.users.telegram_chat_id,
          `❌ *Transfer Failed*\n\n` +
          `💰 Amount: ₦${parseFloat(tx.amount).toLocaleString()}\n` +
          `❗ Reason: ${eventData.reason || "Unknown"}\n` +
          `💵 Refunded: ₦${refundAmount.toLocaleString()}\n` +
          `📊 New Balance: ₦${newBalance.toLocaleString()}`,
          { parse_mode: "Markdown" }
        );
      }
    }
  } catch (error) {
    console.error("❌ Transfer failure error:", error);
  }
}

/**
 * Log security events
 */
async function logSecurityEvent(supabase, userId, eventType, details) {
  try {
    await supabase.from("security_logs").insert([{
      user_id: userId,
      event_type: eventType,
      details,
      ip_address: "webhook",
      user_agent: "paystack_webhook",
      created_at: new Date().toISOString()
    }]);
  } catch (error) {
    console.error("❌ Security logging error:", error);
  }
}

export default app;