const express = require('express');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Paystack webhook endpoint
router.post('/paystack-webhook', async (req, res) => {
  const hash = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (hash !== req.headers['x-paystack-signature']) {
    return res.status(400).send('Invalid signature');
  }

  const event = req.body;

  try {
    if (event.event === 'charge.success') {
      const { reference, amount, customer, channel } = event.data;

      // Handle successful payment
      if (channel === 'dedicated_nuban') {
        // This is a wallet funding transaction
        await handleWalletFunding(customer, amount / 100); // Convert from kobo to naira
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).send('Internal server error');
  }
});

async function handleWalletFunding(customerData, amount) {
  try {
    // Find user by customer code
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('paystack_customer_code', customerData.customer_code)
      .single();

    if (!user) {
      console.error('User not found for customer code:', customerData.customer_code);
      return;
    }

    // Update wallet balance
    const newBalance = parseFloat(user.wallet_balance) + amount;
    await supabase
      .from('users')
      .update({ wallet_balance: newBalance })
      .eq('id', user.id);

    // Record transaction
    const reference = `FUND_${Date.now()}_${user.id.substr(0, 8)}`;
    await supabase
      .from('transactions')
      .insert([{
        user_id: user.id,
        type: 'credit',
        amount: amount,
        service_fee: 0,
        description: 'Wallet funding via bank transfer',
        reference: reference,
        status: 'completed'
      }]);

    // Notify user via Telegram
    if (user.telegram_chat_id) {
      const TelegramBot = require('node-telegram-bot-api');
      const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);

      await bot.sendMessage(user.telegram_chat_id, 
        `✅ Wallet Funded Successfully!\n\n` +
        `💰 Amount: ₦${amount.toLocaleString()}\n` +
        `💵 New Balance: ₦${newBalance.toLocaleString()}\n` +
        `🔖 Reference: ${reference}\n\n` +
        `Your wallet has been credited instantly! 🎉`);
    }

    console.log(`Wallet funded for user ${user.id}: ₦${amount}`);
  } catch (error) {
    console.error('Wallet funding error:', error);
  }
}

module.exports = router;