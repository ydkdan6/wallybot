class WalletWorkflowService {
  constructor(nlpService, ocrService, paystackService, beneficiaryService) {
    this.nlp = nlpService;
    this.ocr = ocrService;
    this.paystack = paystackService;
    this.beneficiary = beneficiaryService;
  }

  async processUserInput(userId, input) {
    try {
      const inputType = this.detectInputType(input);
      
      switch (inputType) {
        case 'IMAGE':
          return await this.processImageInput(userId, input.imageUrl);
        case 'TEXT':
          return await this.processTextInput(userId, input.message);
        default:
          return {
            success: false,
            message: "Unsupported input type. Please send text or an image."
          };
      }
    } catch (error) {
      console.error('Workflow processing error:', error);
      return {
        success: false,
        message: "Sorry, I encountered an error. Please try again."
      };
    }
  }

  detectInputType(input) {
    if (input.imageUrl) return 'IMAGE';
    if (input.message) return 'TEXT';
    return 'UNKNOWN';
  }

  async processImageInput(userId, imageUrl) {
    try {
      console.log('🖼️ Processing image input for user:', userId);
      
      // Extract text from image using OCR
      const extractedText = await this.ocr.extractText(imageUrl);
      
      if (!extractedText || extractedText.length < 10) {
        return {
          success: false,
          message: "❌ Could not extract text from the image. Please ensure:\n\n" +
                   "• Image is clear and well-lit\n" +
                   "• Text is readable\n" +
                   "• Image shows bank statement or account details\n\n" +
                   "Or enter details manually."
        };
      }

      console.log('📝 Text extracted successfully, length:', extractedText.length);

      // Extract and validate account information with Paystack
      const extractedInfo = await this.ocr.extractAndValidateAccountInfo(extractedText);
      
      console.log('📊 Extracted info:', {
        hasAccountNumber: !!extractedInfo.accountNumber,
        hasBank: !!extractedInfo.bankName,
        validated: extractedInfo.validated
      });

      // Check if we have minimum required information
      if (!extractedInfo.accountNumber) {
        return {
          success: false,
          message: "❌ Could not find account number in the image.\n\n" +
                   "💡 Tips:\n" +
                   "• Make sure the account number (10 digits) is visible\n" +
                   "• Try a clearer image\n" +
                   "• Or tell me: 'Add 0123456789 GTBank as John'",
          action: 'ACCOUNT_NOT_FOUND',
          data: { extractedText: extractedText.substring(0, 500) }
        };
      }

      if (!extractedInfo.bankCode) {
        return {
          success: false,
          message: `❌ Found account number ${extractedInfo.accountNumber} but couldn't identify the bank.\n\n` +
                   "Please tell me which bank:\n" +
                   "Example: 'This is GTBank' or 'Add to Access Bank'",
          action: 'BANK_NOT_FOUND',
          data: { 
            accountNumber: extractedInfo.accountNumber,
            extractedText: extractedText.substring(0, 500)
          }
        };
      }

      // Account validated with Paystack
      if (extractedInfo.validated && extractedInfo.accountName) {
        console.log('✅ Account validated successfully');
        
        // Check if amount was also extracted
        if (extractedInfo.amount) {
          return {
            success: true,
            message: `✅ *Account Verified Successfully!*\n\n` +
                     `👤 *Name:* ${extractedInfo.accountName}\n` +
                     `📱 *Account:* ${extractedInfo.accountNumber}\n` +
                     `🏦 *Bank:* ${extractedInfo.bankName}\n` +
                     `💰 *Amount:* ₦${extractedInfo.amount.toLocaleString()}\n\n` +
                     `Would you like to:\n` +
                     `1️⃣ Send ₦${extractedInfo.amount.toLocaleString()} to this account?\n` +
                     `2️⃣ Save this account as a beneficiary?\n\n` +
                     `Reply 'yes' to proceed with transfer or 'save as [nickname]' to add as beneficiary.`,
            action: 'CONFIRM_TRANSFER_FROM_IMAGE',
            data: {
              amount: extractedInfo.amount,
              accountNumber: extractedInfo.accountNumber,
              accountName: extractedInfo.accountName,
              bankCode: extractedInfo.bankCode,
              bankName: extractedInfo.bankName,
              extractedText,
              validated: true
            }
          };
        }

        // Amount not found, ask for it
        return {
          success: true,
          message: `✅ *Account Verified Successfully!*\n\n` +
                   `👤 *Name:* ${extractedInfo.accountName}\n` +
                   `📱 *Account:* ${extractedInfo.accountNumber}\n` +
                   `🏦 *Bank:* ${extractedInfo.bankName}\n\n` +
                   `💰 How much would you like to send?\n\n` +
                   `Or reply 'save as [nickname]' to add as beneficiary.`,
          action: 'REQUEST_AMOUNT_FOR_VERIFIED_ACCOUNT',
          data: {
            accountNumber: extractedInfo.accountNumber,
            accountName: extractedInfo.accountName,
            bankCode: extractedInfo.bankCode,
            bankName: extractedInfo.bankName,
            extractedText,
            validated: true
          }
        };
      }

      // Validation failed - account details found but couldn't verify
      return {
        success: false,
        message: `⚠️ Found account details but couldn't verify:\n\n` +
                 `📱 Account: ${extractedInfo.accountNumber}\n` +
                 `🏦 Bank: ${extractedInfo.bankName}\n\n` +
                 `${extractedInfo.validationError || 'The account could not be verified with the bank.'}\n\n` +
                 `Please check the details or try again.`,
        action: 'ACCOUNT_VALIDATION_FAILED',
        data: { 
          extractedInfo, 
          error: extractedInfo.validationError 
        }
      };

    } catch (error) {
      console.error('❌ Image processing error:', error);
      return {
        success: false,
        message: "❌ Failed to process the image.\n\n" +
                 `Error: ${error.message}\n\n` +
                 "Please try:\n" +
                 "• A clearer image\n" +
                 "• Better lighting\n" +
                 "• Or enter details manually"
      };
    }
  }

  async validateAccountWithPaystack(accountInfo) {
    try {
      const validation = await this.paystack.resolveAccountNumber(
        accountInfo.accountNumber,
        accountInfo.bankCode
      );

      if (validation.status && validation.data) {
        return {
          success: true,
          accountName: validation.data.account_name,
          accountNumber: validation.data.account_number
        };
      }

      return {
        success: false,
        message: "Account validation failed. Please check the details."
      };

    } catch (error) {
      console.error('Paystack validation error:', error);
      return {
        success: false,
        message: error.message || "Could not validate account with bank."
      };
    }
  }

  async processTextInput(userId, message) {
    try {
      // Get user's beneficiaries for context
      const beneficiariesResult = await this.beneficiary.getBeneficiaries(userId);
      const beneficiaries = beneficiariesResult.beneficiaries || [];

      // Analyze message with NLP
      const intent = await this.nlp.processMessage(message);
      
      // Process based on intent
      switch (intent.type) {
        case 'FUND_WALLET':
          return await this.handleFundWallet(userId, intent);
        
        case 'SEND_MONEY':
          return await this.handleSendMoney(userId, intent, beneficiaries);
        
        case 'SEND_TO_BENEFICIARY':
          return await this.handleSendToBeneficiary(userId, intent, beneficiaries);
        
        case 'ADD_BENEFICIARY':
          return await this.handleAddBeneficiary(userId, intent);
        
        case 'LIST_BENEFICIARIES':
          return await this.handleListBeneficiaries(userId, beneficiaries);
        
        case 'CHECK_BALANCE':
          return await this.handleCheckBalance(userId);
        
        case 'TRANSACTION_HISTORY':
          return await this.handleTransactionHistory(userId);
        
        default:
          return await this.handleGeneralChat(userId, message, { beneficiaries });
      }

    } catch (error) {
      console.error('Text processing error:', error);
      return {
        success: false,
        message: "I couldn't understand your request. Please try again or contact support."
      };
    }
  }

  async handleFundWallet(userId, intent) {
    const amount = intent.amount;
    const message = amount 
      ? `You can fund your wallet with ₦${amount.toLocaleString()}. Use your dedicated account number for bank transfers, or use other funding methods in the app.`
      : "I can help you fund your wallet! You can use bank transfer to your dedicated account number or other available funding methods.";
    
    return {
      success: true,
      message,
      action: 'SHOW_FUNDING_OPTIONS',
      data: { requestedAmount: amount }
    };
  }

  async handleSendMoney(userId, intent, beneficiaries) {
    const { amount, account_number, recipient_name, bank_name } = intent;
    
    if (!amount || !account_number) {
      return {
        success: true,
        message: "To send money, I need the amount and recipient's account number. Please provide the missing details.",
        action: 'REQUEST_TRANSFER_DETAILS',
        data: { amount, account_number, recipient_name, bank_name }
      };
    }

    // Check if this account exists in beneficiaries
    const existingBeneficiary = beneficiaries.find(b => b.account_number === account_number);
    
    if (existingBeneficiary) {
      return {
        success: true,
        message: `Send ₦${amount.toLocaleString()} to ${existingBeneficiary.account_name} (${existingBeneficiary.nickname})? ✅`,
        action: 'CONFIRM_TRANSFER_TO_BENEFICIARY',
        data: {
          amount,
          beneficiary: existingBeneficiary
        }
      };
    }

    return {
      success: true,
      message: `Send ₦${amount.toLocaleString()} to ${account_number}${recipient_name ? ` (${recipient_name})` : ''}? I'll verify the account details first.`,
      action: 'CONFIRM_NEW_TRANSFER',
      data: { amount, account_number, recipient_name, bank_name }
    };
  }

  async handleSendToBeneficiary(userId, intent, beneficiaries) {
    const { amount, beneficiary_nickname } = intent;
    
    if (!beneficiary_nickname) {
      return {
        success: true,
        message: "Which beneficiary would you like to send money to?",
        action: 'LIST_BENEFICIARIES',
        data: { requestedAmount: amount }
      };
    }

    const beneficiary = beneficiaries.find(b => 
      b.nickname.toLowerCase().includes(beneficiary_nickname.toLowerCase())
    );

    if (!beneficiary) {
      const suggestions = beneficiaries
        .filter(b => b.nickname.toLowerCase().includes(beneficiary_nickname.charAt(0)))
        .slice(0, 3);

      let message = `I couldn't find a beneficiary named "${beneficiary_nickname}".`;
      
      if (suggestions.length > 0) {
        message += ` Did you mean: ${suggestions.map(s => s.nickname).join(', ')}?`;
      } else if (beneficiaries.length > 0) {
        message += ` Your saved beneficiaries are: ${beneficiaries.map(b => b.nickname).join(', ')}.`;
      } else {
        message += " You don't have any saved beneficiaries yet.";
      }

      return {
        success: true,
        message,
        action: 'CLARIFY_BENEFICIARY',
        data: { amount, requestedNickname: beneficiary_nickname, suggestions }
      };
    }

    if (!amount) {
      return {
        success: true,
        message: `How much would you like to send to ${beneficiary.account_name} (${beneficiary.nickname})?`,
        action: 'REQUEST_AMOUNT',
        data: { beneficiary }
      };
    }

    return {
      success: true,
      message: `Send ₦${amount.toLocaleString()} to ${beneficiary.account_name} (${beneficiary.nickname})? ✅`,
      action: 'CONFIRM_TRANSFER_TO_BENEFICIARY',
      data: { amount, beneficiary }
    };
  }

  async handleAddBeneficiary(userId, intent) {
    const { account_number, recipient_name, bank_name, nickname } = intent;
    
    if (!account_number || !nickname) {
      return {
        success: true,
        message: "To add a beneficiary, I need their account number and a nickname for them. You can also upload a bank statement image!",
        action: 'REQUEST_BENEFICIARY_DETAILS',
        data: { account_number, recipient_name, bank_name, nickname }
      };
    }

    return {
      success: true,
      message: `Add ${account_number}${bank_name ? ` (${bank_name})` : ''} as "${nickname}"? I'll verify the account first.`,
      action: 'CONFIRM_ADD_BENEFICIARY',
      data: { account_number, recipient_name, bank_name, nickname }
    };
  }

  async handleListBeneficiaries(userId, beneficiaries) {
    const message = this.beneficiary.formatBeneficiariesList(beneficiaries);
    
    return {
      success: true,
      message,
      action: 'SHOW_BENEFICIARIES',
      data: { beneficiaries }
    };
  }

  async handleCheckBalance(userId) {
    return {
      success: true,
      message: "Let me check your wallet balance! 💳",
      action: 'CHECK_BALANCE',
      data: {}
    };
  }

  async handleTransactionHistory(userId) {
    return {
      success: true,
      message: "Here's your recent transaction history! 📊",
      action: 'SHOW_TRANSACTION_HISTORY',
      data: {}
    };
  }

  async handleGeneralChat(userId, message, context) {
    const response = await this.nlp.generateResponse({ type: 'GENERAL_CHAT' }, context);
    
    return {
      success: true,
      message: response,
      action: 'GENERAL_RESPONSE',
      data: {}
    };
  }

  // Helper method to execute confirmed transfers
  async executeTransfer(userId, transferData) {
    try {
      const { amount, beneficiary, accountNumber, accountName, bankCode } = transferData;
      
      // Initiate transfer via Paystack
      const transfer = await this.paystack.initiateTransfer({
        source: 'balance',
        amount: amount * 100, // Convert to kobo
        recipient: accountNumber,
        reason: `Transfer to ${accountName || beneficiary?.account_name}`,
        currency: 'NGN',
        reference: `QW${Date.now()}${Math.floor(Math.random() * 1000)}`,
        bank_code: bankCode || beneficiary?.bank_code
      });

      if (transfer.status && transfer.data) {
        return {
          success: true,
          message: `✅ Transfer of ₦${amount.toLocaleString()} sent successfully to ${accountName || beneficiary?.account_name}!`,
          action: 'TRANSFER_COMPLETED',
          data: {
            amount,
            recipient: accountName || beneficiary?.account_name,
            reference: transfer.data.reference,
            timestamp: new Date().toISOString(),
            transferCode: transfer.data.transfer_code
          }
        };
      }

      return {
        success: false,
        message: "Transfer could not be completed. Please try again.",
        action: 'TRANSFER_FAILED',
        data: { error: transfer.message }
      };

    } catch (error) {
      console.error('Execute transfer error:', error);
      return {
        success: false,
        message: `Transfer failed: ${error.message}. Please try again or contact support.`,
        action: 'TRANSFER_FAILED',
        data: { error: error.message }
      };
    }
  }

  // Helper method to add confirmed beneficiary
  async executeAddBeneficiary(userId, beneficiaryData) {
    try {
      const result = await this.beneficiary.addBeneficiary(userId, beneficiaryData);
      
      if (result.success) {
        return {
          success: true,
          message: result.message,
          action: 'BENEFICIARY_ADDED',
          data: { beneficiary: result.beneficiary }
        };
      } else {
        return {
          success: false,
          message: result.message,
          action: 'ADD_BENEFICIARY_FAILED',
          data: { error: result.message }
        };
      }

    } catch (error) {
      console.error('Execute add beneficiary error:', error);
      return {
        success: false,
        message: "Failed to add beneficiary. Please try again."
      };
    }
  }

  // Method to handle conversation context and maintain state
  async processFollowUp(userId, message, conversationContext) {
    try {
      const { lastAction, pendingData } = conversationContext;

      switch (lastAction) {
        case 'REQUEST_AMOUNT_FOR_VERIFIED_ACCOUNT':
          // User provided amount for verified account from image
          const amountMatch = message.match(/(\d+(?:,\d+)*(?:\.\d{2})?)/);
          if (amountMatch) {
            const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
            
            if (amount < 100) {
              return {
                success: false,
                message: "❌ Amount too low. Minimum is ₦100. Please enter a valid amount.",
                action: 'REQUEST_AMOUNT_FOR_VERIFIED_ACCOUNT',
                data: pendingData
              };
            }
            
            return {
              success: true,
              message: `Send ₦${amount.toLocaleString()} to ${pendingData.accountName} (${pendingData.accountNumber})?\n\n` +
                       `🏦 ${pendingData.bankName}\n\n` +
                       `Reply 'yes' to confirm or 'no' to cancel.`,
              action: 'CONFIRM_TRANSFER_FROM_IMAGE',
              data: { 
                amount, 
                accountNumber: pendingData.accountNumber,
                accountName: pendingData.accountName,
                bankCode: pendingData.bankCode,
                bankName: pendingData.bankName
              }
            };
          } else if (message.toLowerCase().startsWith('save')) {
            // User wants to save as beneficiary instead
            const nicknameMatch = message.match(/save\s+as\s+(.+)/i);
            const nickname = nicknameMatch ? nicknameMatch[1].trim() : null;
            
            if (!nickname) {
              return {
                success: false,
                message: "Please specify a nickname. Example: 'save as John'",
                action: 'REQUEST_AMOUNT_FOR_VERIFIED_ACCOUNT',
                data: pendingData
              };
            }
            
            return {
              success: true,
              message: `Save ${pendingData.accountName} (${pendingData.accountNumber}) as "${nickname}"?`,
              action: 'CONFIRM_ADD_BENEFICIARY',
              data: {
                account_number: pendingData.accountNumber,
                recipient_name: pendingData.accountName,
                bank_name: pendingData.bankName,
                bank_code: pendingData.bankCode,
                nickname
              }
            };
          } else {
            return {
              success: false,
              message: "❌ Please enter a valid amount (numbers only) or 'save as [nickname]' to add as beneficiary.",
              action: 'REQUEST_AMOUNT_FOR_VERIFIED_ACCOUNT',
              data: pendingData
            };
          }

        case 'REQUEST_TRANSFER_DETAILS':
          // User provided missing transfer details
          const updatedIntent = await this.nlp.processMessage(message);
          const mergedData = { ...pendingData, ...updatedIntent };
          
          // Get beneficiaries for context
          const beneficiariesResult = await this.beneficiary.getBeneficiaries(userId);
          const beneficiaries = beneficiariesResult.beneficiaries || [];
          
          return await this.handleSendMoney(userId, mergedData, beneficiaries);

        case 'REQUEST_AMOUNT':
          // User provided amount for beneficiary transfer
          const beneficiaryAmountMatch = message.match(/(\d+(?:,\d+)*(?:\.\d{2})?)/);
          if (beneficiaryAmountMatch) {
            const amount = parseFloat(beneficiaryAmountMatch[1].replace(/,/g, ''));
            
            if (amount < 100) {
              return {
                success: false,
                message: "❌ Amount too low. Minimum is ₦100. Please enter a valid amount.",
                action: 'REQUEST_AMOUNT',
                data: pendingData
              };
            }
            
            return {
              success: true,
              message: `Send ₦${amount.toLocaleString()} to ${pendingData.beneficiary.account_name} (${pendingData.beneficiary.nickname})?\n\n` +
                       `🏦 ${pendingData.beneficiary.bank_name}\n` +
                       `📱 ${pendingData.beneficiary.account_number}\n\n` +
                       `Reply 'yes' to confirm.`,
              action: 'CONFIRM_TRANSFER_TO_BENEFICIARY',
              data: { amount, beneficiary: pendingData.beneficiary }
            };
          } else {
            return {
              success: false,
              message: "❌ Please enter a valid amount (numbers only).",
              action: 'REQUEST_AMOUNT',
              data: pendingData
            };
          }

        case 'REQUEST_BENEFICIARY_DETAILS':
          // User provided missing beneficiary details
          const beneficiaryIntent = await this.nlp.processMessage(message);
          const mergedBeneficiaryData = { ...pendingData, ...beneficiaryIntent };
          return await this.handleAddBeneficiary(userId, mergedBeneficiaryData);

        case 'BANK_NOT_FOUND':
          // User provided bank name for extracted account number
          const bankIntent = await this.nlp.processMessage(message);
          
          if (bankIntent.bank_name) {
            const bankCode = this.ocr.resolveBankCode(bankIntent.bank_name);
            
            if (bankCode) {
              // Validate the account with the bank
              const validation = await this.paystack.resolveAccountNumber(
                pendingData.accountNumber,
                bankCode
              );
              
              if (validation.status && validation.data) {
                return {
                  success: true,
                  message: `✅ *Account Verified!*\n\n` +
                           `👤 ${validation.data.account_name}\n` +
                           `📱 ${pendingData.accountNumber}\n` +
                           `🏦 ${bankIntent.bank_name}\n\n` +
                           `How much would you like to send?`,
                  action: 'REQUEST_AMOUNT_FOR_VERIFIED_ACCOUNT',
                  data: {
                    accountNumber: pendingData.accountNumber,
                    accountName: validation.data.account_name,
                    bankCode: bankCode,
                    bankName: bankIntent.bank_name,
                    validated: true
                  }
                };
              } else {
                return {
                  success: false,
                  message: `❌ Could not verify account ${pendingData.accountNumber} with ${bankIntent.bank_name}.\n\n` +
                           `Please check the details and try again.`
                };
              }
            } else {
              return {
                success: false,
                message: `❌ Bank "${bankIntent.bank_name}" not recognized.\n\n` +
                         `Supported banks: GTBank, Access Bank, Zenith, UBA, First Bank, etc.\n\n` +
                         `Please try again.`,
                action: 'BANK_NOT_FOUND',
                data: pendingData
              };
            }
          } else {
            return {
              success: false,
              message: "❌ Please tell me which bank. Example: 'GTBank' or 'Access Bank'",
              action: 'BANK_NOT_FOUND',
              data: pendingData
            };
          }

        case 'ACCOUNT_NOT_FOUND':
          // User wants to provide details manually after OCR failed
          const manualIntent = await this.nlp.processMessage(message);
          
          if (manualIntent.account_number) {
            return await this.handleAddBeneficiary(userId, manualIntent);
          } else {
            return {
              success: false,
              message: "❌ I still couldn't find an account number. Please provide it like:\n\n" +
                       "'Add 0123456789 GTBank as John'",
              action: 'ACCOUNT_NOT_FOUND',
              data: pendingData
            };
          }

        default:
          // No specific context, process as new input
          return await this.processTextInput(userId, message);
      }

    } catch (error) {
      console.error('Follow-up processing error:', error);
      return {
        success: false,
        message: "❌ I couldn't process your request. Please start over."
      };
    }
  }

  // Method to handle confirmations (Yes/No responses)
  async processConfirmation(userId, isConfirmed, confirmationContext) {
    try {
      const { action, data } = confirmationContext;

      if (!isConfirmed) {
        return {
          success: true,
          message: "❌ Operation cancelled. How else can I help you? 😊",
          action: 'OPERATION_CANCELLED',
          data: {}
        };
      }

      switch (action) {
        case 'CONFIRM_TRANSFER_FROM_IMAGE':
        case 'CONFIRM_TRANSFER_TO_BENEFICIARY':
        case 'CONFIRM_NEW_TRANSFER':
          return await this.executeTransfer(userId, data);

        case 'CONFIRM_ADD_BENEFICIARY':
          return await this.executeAddBeneficiary(userId, data);

        default:
          return {
            success: false,
            message: "❌ Unknown confirmation request. Please try again."
          };
      }

    } catch (error) {
      console.error('Confirmation processing error:', error);
      return {
        success: false,
        message: "❌ Failed to process confirmation. Please try again."
      };
    }
  }
}

export default WalletWorkflowService;