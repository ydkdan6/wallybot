// import crypto from 'crypto';

// /**
//  * Enhanced Paystack webhook handler with transaction verification
//  */
// export async function handlePaystackWebhook(req, res, supabase, bot, paystackService) {
//   try {
//     // Verify webhook signature
//     const hash = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
//       .update(JSON.stringify(req.body))
//       .digest('hex');

//     if (hash !== req.headers['x-paystack-signature']) {
//       console.error('❌ Invalid webhook signature');
//       return res.status(400).send('Invalid signature');
//     }

//     const event = req.body;
//     console.log('📥 Paystack Webhook Event:', event.event);
//     console.log('📦 Event Data:', JSON.stringify(event.data, null, 2));

//     // Handle different event types
//     switch (event.event) {
//       case 'charge.success':
//         // Handle successful charges (includes virtual account transfers)
//         if (event.data.channel === 'dedicated_nuban') {
//           await handleWalletFunding(event.data, supabase, bot, paystackService);
//         }
//         break;

//       case 'transfer.success':
//         // Handle successful transfers to virtual accounts
//         await handleWalletFunding(event.data, supabase, bot, paystackService);
//         break;

//       case 'transfer.failed':
//         // Handle failed transfers
//         await handleTransferFailure(event.data, supabase, bot);
//         break;

//       case 'dedicatedaccount.assign.success':
//         console.log('✅ Virtual account assigned:', event.data);
//         break;

//       case 'dedicatedaccount.assign.failed':
//         console.error('❌ Virtual account assignment failed:', event.data);
//         break;

//       default:
//         console.log('ℹ️ Unhandled event type:', event.event);
//     }

//     // Always respond with 200 to acknowledge receipt
//     res.status(200).send('OK');
//   } catch (error) {
//     console.error('❌ Webhook processing error:', error);
//     // Still return 200 to prevent Paystack from retrying
//     res.status(200).send('Error logged');
//   }
// }

// /**
//  * Handle wallet funding with enhanced verification
//  */
// async function handleWalletFunding(eventData, supabase, bot, paystackService) {
//   try {
//     console.log('💰 Processing wallet funding...');

//     // Extract transaction details based on event structure
//     let amount, reference, customerCode, senderDetails;

//     if (eventData.customer && eventData.channel === 'dedicated_nuban') {
//       // From charge.success event
//       customerCode = eventData.customer.customer_code;
//       amount = eventData.amount / 100; // Convert kobo to naira
//       reference = eventData.reference;
//       senderDetails = {
//         name: eventData.metadata?.sender_name || eventData.metadata?.account_name || 'Bank Transfer',
//         bank: eventData.metadata?.sender_bank || 'External Bank'
//       };
//     } else if (eventData.dedicated_account) {
//       // From transfer.success event
//       customerCode = eventData.dedicated_account.customer.customer_code;
//       amount = eventData.amount / 100;
//       reference = eventData.reference;
//       senderDetails = {
//         name: eventData.source?.account_name || 'Bank Transfer',
//         bank: eventData.source?.bank || 'External Bank'
//       };
//     } else {
//       console.error('❌ Unknown event structure');
//       return;
//     }

//     console.log('💵 Transaction Details:', {
//       customerCode,
//       amount: `₦${amount.toLocaleString()}`,
//       reference,
//       sender: senderDetails.name
//     });

//     // STEP 1: Verify transaction with Paystack API
//     console.log('🔍 Verifying transaction with Paystack...');
//     let verifiedTransaction;
//     try {
//       verifiedTransaction = await paystackService.verifyAndGetTransactionDetails(reference);
//       console.log('✅ Transaction verified:', verifiedTransaction);

//       // Double-check the amount matches
//       if (verifiedTransaction.amount !== amount) {
//         console.error('⚠️ Amount mismatch! Webhook:', amount, 'Verified:', verifiedTransaction.amount);
//         amount = verifiedTransaction.amount; // Use verified amount
//       }

//       // Check if transaction was actually successful
//       if (verifiedTransaction.status !== 'success') {
//         console.error('❌ Transaction not successful:', verifiedTransaction.status);
//         return;
//       }
//     } catch (verifyError) {
//       console.error('❌ Transaction verification failed:', verifyError.message);
//       // Don't proceed if we can't verify the transaction
//       return;
//     }

//     // STEP 2: Find user by customer code
//     const { data: user, error: userError } = await supabase
//       .from('users')
//       .select('*')
//       .eq('paystack_customer_code', customerCode)
//       .single();

//     if (userError || !user) {
//       console.error('❌ User not found for customer code:', customerCode);
//       await logFailedFunding(supabase, {
//         customer_code: customerCode,
//         amount,
//         reference,
//         reason: 'User not found',
//         event_data: eventData
//       });
//       return;
//     }

//     console.log('👤 User found:', {
//       id: user.id,
//       name: `${user.first_name} ${user.last_name}`,
//       email: user.email,
//       current_balance: user.wallet_balance
//     });

//     // STEP 3: Check for duplicate transaction
//     const { data: existingTxn } = await supabase
//       .from('transactions')
//       .select('id, status, amount')
//       .eq('reference', reference)
//       .maybeSingle();

//     if (existingTxn) {
//       console.log('⚠️ Duplicate transaction detected:', {
//         txn_id: existingTxn.id,
//         status: existingTxn.status,
//         amount: existingTxn.amount
//       });
      
//       // If transaction exists but balance wasn't updated, we might need to retry
//       if (existingTxn.status === 'pending') {
//         console.log('🔄 Retrying pending transaction...');
//       } else {
//         return; // Transaction already processed
//       }
//     }

//     // STEP 4: Calculate new balance
//     const currentBalance = parseFloat(user.wallet_balance || 0);
//     const newBalance = currentBalance + amount;

//     console.log('💰 Balance Update:', {
//       previous: `₦${currentBalance.toLocaleString()}`,
//       added: `₦${amount.toLocaleString()}`,
//       new: `₦${newBalance.toLocaleString()}`
//     });

//     // STEP 5: Update wallet balance with optimistic locking
//     const { data: updatedUser, error: balanceError } = await supabase
//       .from('users')
//       .update({ 
//         wallet_balance: newBalance,
//         updated_at: new Date().toISOString()
//       })
//       .eq('id', user.id)
//       .eq('wallet_balance', currentBalance) // Optimistic locking
//       .select()
//       .single();

//     if (balanceError) {
//       console.error('❌ Balance update failed:', balanceError);
      
//       // Log the failure for manual review
//       await logFailedFunding(supabase, {
//         user_id: user.id,
//         customer_code: customerCode,
//         amount,
//         reference,
//         reason: 'Balance update failed',
//         error: balanceError.message
//       });
      
//       throw balanceError;
//     }

//     if (!updatedUser) {
//       console.error('⚠️ Balance update conflict - another transaction in progress');
//       // Retry after a short delay
//       await new Promise(resolve => setTimeout(resolve, 1000));
//       return handleWalletFunding(eventData, supabase, bot, paystackService);
//     }

//     console.log('✅ Balance updated successfully');

//     // STEP 6: Record transaction in database
//     const { data: transaction, error: txnError } = await supabase
//       .from('transactions')
//       .insert([{
//         user_id: user.id,
//         type: 'credit',
//         amount: amount,
//         service_fee: 0.00,
//         recipient_account: null,
//         recipient_name: null,
//         description: `Wallet funding from ${senderDetails.name} via ${senderDetails.bank}`,
//         reference: reference,
//         status: 'completed',
//         metadata: JSON.stringify({
//           sender_name: senderDetails.name,
//           sender_bank: senderDetails.bank,
//           channel: verifiedTransaction.channel,
//           verified_at: new Date().toISOString()
//         }),
//         created_at: new Date().toISOString()
//       }])
//       .select()
//       .single();

//     if (txnError) {
//       console.error('❌ Transaction recording failed:', txnError);
      
//       // Critical: Balance was updated but transaction wasn't recorded
//       // Rollback the balance
//       await supabase
//         .from('users')
//         .update({ wallet_balance: currentBalance })
//         .eq('id', user.id);
      
//       await logFailedFunding(supabase, {
//         user_id: user.id,
//         customer_code: customerCode,
//         amount,
//         reference,
//         reason: 'Transaction recording failed - balance rolled back',
//         error: txnError.message
//       });
      
//       throw txnError;
//     }

//     console.log('✅ Transaction recorded:', transaction.id);

//     // STEP 7: Verify final balance matches expectations
//     const { data: finalUser } = await supabase
//       .from('users')
//       .select('wallet_balance')
//       .eq('id', user.id)
//       .single();

//     const finalBalance = parseFloat(finalUser.wallet_balance);
//     if (Math.abs(finalBalance - newBalance) > 0.01) {
//       console.error('⚠️ Balance mismatch detected!', {
//         expected: newBalance,
//         actual: finalBalance,
//         difference: finalBalance - newBalance
//       });
      
//       await logFailedFunding(supabase, {
//         user_id: user.id,
//         amount,
//         reference,
//         reason: 'Balance verification failed',
//         expected_balance: newBalance,
//         actual_balance: finalBalance
//       });
//     } else {
//       console.log('✅ Balance verification passed');
//     }

//     // STEP 8: Check Paystack integration balance
//     try {
//       const paystackBalance = await paystackService.checkBalance();
//       console.log('💰 Paystack Integration Balance:', paystackBalance);
      
//       // Log for reconciliation
//       await supabase
//         .from('balance_reconciliation')
//         .insert([{
//           user_id: user.id,
//           transaction_id: transaction.id,
//           user_balance: newBalance,
//           paystack_balance: paystackBalance[0]?.balance / 100 || 0,
//           reference: reference,
//           created_at: new Date().toISOString()
//         }]);
//     } catch (balanceCheckError) {
//       console.error('⚠️ Could not check Paystack balance:', balanceCheckError.message);
//       // Non-critical, continue
//     }

//     // STEP 9: Send Telegram notification
//     if (user.telegram_chat_id) {
//       try {
//         const notificationMessage = 
//           `✅ *Wallet Funded Successfully!*\n\n` +
//           `💰 *Amount:* ₦${amount.toLocaleString()}\n` +
//           `💵 *New Balance:* ₦${newBalance.toLocaleString()}\n` +
//           `👤 *From:* ${senderDetails.name}\n` +
//           `🏦 *Bank:* ${senderDetails.bank}\n` +
//           `🔖 *Reference:* \`${reference}\`\n` +
//           `✅ *Status:* Verified & Completed\n` +
//           `⏰ *Time:* ${new Date().toLocaleString('en-NG', { 
//             timeZone: 'Africa/Lagos',
//             dateStyle: 'medium',
//             timeStyle: 'short'
//           })}\n\n` +
//           `Your wallet has been credited and verified! 🎉`;

//         await bot.sendMessage(user.telegram_chat_id, notificationMessage, {
//           parse_mode: 'Markdown'
//         });

//         console.log('📱 Telegram notification sent');
//       } catch (botError) {
//         console.error('❌ Telegram notification failed:', botError.message);
//         // Non-critical, transaction is complete
//       }
//     }

//     console.log(`✅ WALLET FUNDING COMPLETE: User ${user.id}, +₦${amount}, Balance: ₦${newBalance}`);

//     // Log success to security logs
//     await logSecurityEvent(supabase, user.id, 'WALLET_FUNDED', {
//       amount,
//       reference,
//       sender: senderDetails.name,
//       new_balance: newBalance,
//       verified: true
//     });

//   } catch (error) {
//     console.error('❌ Wallet funding error:', error);
    
//     // Log critical error
//     await logSecurityEvent(supabase, null, 'WEBHOOK_ERROR', {
//       error: error.message,
//       stack: error.stack,
//       event_data: eventData
//     });
//   }
// }

// /**
//  * Handle transfer failures
//  */
// async function handleTransferFailure(eventData, supabase, bot) {
//   try {
//     console.log('❌ Processing transfer failure:', eventData.reference);
    
//     // Find and update the transaction
//     const { data: transaction } = await supabase
//       .from('transactions')
//       .select('*, users!inner(telegram_chat_id)')
//       .eq('reference', eventData.reference)
//       .single();

//     if (transaction) {
//       // Update transaction status
//       await supabase
//         .from('transactions')
//         .update({ 
//           status: 'failed',
//           metadata: JSON.stringify({
//             failure_reason: eventData.reason || 'Transfer failed',
//             failed_at: new Date().toISOString()
//           })
//         })
//         .eq('id', transaction.id);

//       // Notify user
//       if (transaction.users.telegram_chat_id) {
//         await bot.sendMessage(
//           transaction.users.telegram_chat_id,
//           `❌ *Transfer Failed*\n\n` +
//           `Reference: ${eventData.reference}\n` +
//           `Reason: ${eventData.reason || 'Unknown error'}\n\n` +
//           `Please contact support if you need assistance.`,
//           { parse_mode: 'Markdown' }
//         );
//       }
//     }
//   } catch (error) {
//     console.error('Error handling transfer failure:', error);
//   }
// }

// /**
//  * Log failed funding attempts for manual review
//  */
// async function logFailedFunding(supabase, details) {
//   try {
//     await supabase
//       .from('failed_fundings')
//       .insert([{
//         user_id: details.user_id || null,
//         customer_code: details.customer_code,
//         amount: details.amount,
//         reference: details.reference,
//         reason: details.reason,
//         error_details: JSON.stringify(details),
//         created_at: new Date().toISOString()
//       }]);
//   } catch (error) {
//     console.error('Error logging failed funding:', error);
//   }
// }

// /**
//  * Log security events
//  */
// async function logSecurityEvent(supabase, userId, eventType, details) {
//   try {
//     await supabase
//       .from('security_logs')
//       .insert([{
//         user_id: userId,
//         event_type: eventType,
//         details: JSON.stringify(details),
//         ip_address: 'webhook',
//         user_agent: 'paystack_webhook',
//         created_at: new Date().toISOString()
//       }]);
//   } catch (error) {
//     console.error('Security logging error:', error);
//   }
// }