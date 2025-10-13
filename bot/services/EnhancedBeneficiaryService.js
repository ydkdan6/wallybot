// Enhanced beneficiary addition with better debugging and Opay support
class EnhancedBeneficiaryService {
  constructor(paystackService, supabaseClient) {
    this.paystack = paystackService;
    this.supabase = supabaseClient;
    this.banksCache = null;
    this.banksCacheExpiry = null;
  }

  async getBankList() {
    try {
      if (this.banksCache && this.banksCacheExpiry && Date.now() < this.banksCacheExpiry) {
        return { success: true, banks: this.banksCache };
      }

      console.log('Fetching bank list from Paystack...');
      const banks = await this.paystack.getBankList();
      console.log(`Found ${banks.length} banks from Paystack`);

      this.banksCache = banks.map(bank => ({
        name: bank.name,
        code: bank.code,
        slug: bank.slug || bank.name.toLowerCase().replace(/\s+/g, '-')
      }));
      this.banksCacheExpiry = Date.now() + (60 * 60 * 1000);
      
      return { success: true, banks: this.banksCache };
    } catch (error) {
      console.error('Get bank list error:', error);
      return { success: false, message: 'Failed to get bank list.', banks: [] };
    }
  }

  async findBankByName(bankName) {
    const bankListResponse = await this.getBankList();
    if (!bankListResponse.success) {
      console.error('Could not get bank list');
      return null;
    }

    const banks = bankListResponse.banks;
    const searchName = bankName.toLowerCase().trim();
    console.log(`Searching for bank: "${searchName}" in ${banks.length} banks`);

    // Enhanced aliases with common variations
    const bankAliases = {
      'opay': ['OPay', 'Opay Digital Services Limited', 'OPay Digital Services Limited (OPay)'],
      'moniepoint': ['Moniepoint MFB', 'Moniepoint Microfinance Bank'],
      'kuda': ['Kuda Bank', 'Kuda Microfinance Bank'],
      'gtbank': ['Guaranty Trust Bank', 'GTBank Plc'],
      'gtb': ['Guaranty Trust Bank', 'GTBank Plc'],
      'gt bank': ['Guaranty Trust Bank', 'GTBank Plc'],
      'uba': ['United Bank For Africa', 'UBA'],
      'access': ['Access Bank', 'Access Bank Plc'],
      'zenith': ['Zenith Bank', 'Zenith Bank Plc'],
      'first bank': ['First Bank of Nigeria', 'FirstBank'],
      'firstbank': ['First Bank of Nigeria', 'FirstBank'],
      'fidelity': ['Fidelity Bank', 'Fidelity Bank Plc'],
      'union': ['Union Bank of Nigeria', 'Union Bank'],
      'sterling': ['Sterling Bank', 'Sterling Bank Plc'],
      'fcmb': ['First City Monument Bank', 'FCMB'],
      'wema': ['Wema Bank', 'Wema Bank Plc'],
      'alat': ['ALAT by Wema', 'Wema Bank Plc']
    };

    // Try exact match first
    let matchedBank = banks.find(bank => 
      bank.name.toLowerCase() === searchName
    );

    if (matchedBank) {
      console.log(`Exact match found: ${matchedBank.name} (${matchedBank.code})`);
      return matchedBank;
    }

    // Try aliases
    const aliases = bankAliases[searchName] || [];
    for (const alias of aliases) {
      matchedBank = banks.find(bank => 
        bank.name.toLowerCase().includes(alias.toLowerCase()) ||
        alias.toLowerCase().includes(bank.name.toLowerCase())
      );
      if (matchedBank) {
        console.log(`Alias match found: ${matchedBank.name} (${matchedBank.code}) for "${searchName}"`);
        return matchedBank;
      }
    }

    // Try partial matching
    matchedBank = banks.find(bank => 
      bank.name.toLowerCase().includes(searchName) ||
      searchName.includes(bank.name.toLowerCase().split(' ')[0])
    );

    if (matchedBank) {
      console.log(`Partial match found: ${matchedBank.name} (${matchedBank.code})`);
    } else {
      console.log(`No match found for: "${searchName}"`);
      // Log available banks that might be similar
      const similarBanks = banks.filter(bank => 
        bank.name.toLowerCase().includes(searchName.charAt(0)) ||
        searchName.includes(bank.name.toLowerCase().charAt(0))
      ).slice(0, 5);
      console.log('Similar banks:', similarBanks.map(b => b.name));
    }

    return matchedBank;
  }

  async addBeneficiary(userId, beneficiaryData) {
    try {
      const { nickname, account_number, bank_name, bank_code } = beneficiaryData;
      console.log('=== Adding Beneficiary Debug ===');
      console.log('Input:', { nickname, account_number, bank_name, bank_code });

      let finalBankCode = bank_code;
      let finalBankName = bank_name;

      // Step 1: Resolve bank code if not provided
      if (!finalBankCode && bank_name) {
        console.log(`Step 1: Resolving bank code for "${bank_name}"`);
        const matchedBank = await this.findBankByName(bank_name);
        
        if (!matchedBank) {
          console.log(`Bank "${bank_name}" not found`);
          
          // Get similar banks for suggestions
          const bankListResponse = await this.getBankList();
          let suggestedBanks = [];
          
          if (bankListResponse.success) {
            suggestedBanks = bankListResponse.banks
              .filter(bank => {
                const bankLower = bank.name.toLowerCase();
                const searchLower = bank_name.toLowerCase();
                return bankLower.includes(searchLower.substring(0, 3)) ||
                       searchLower.includes(bankLower.split(' ')[0].substring(0, 3));
              })
              .slice(0, 8); // Show more options
          }

          return {
            success: false,
            message: `❌ Could not find "${bank_name}" in our bank list.\n\n🏦 Did you mean one of these?\n${suggestedBanks.map((bank, i) => `${i + 1}. ${bank.name}`).join('\n')}\n\n💬 Reply with the number or exact bank name.`,
            needsBankSelection: true,
            suggestedBanks: suggestedBanks
          };
        }

        finalBankCode = matchedBank.code;
        finalBankName = matchedBank.name;
        console.log(`Bank resolved: ${finalBankName} (${finalBankCode})`);
      }

      if (!finalBankCode) {
        console.log('No bank code available');
        return {
          success: false,
          message: '❌ Bank code is required. Please specify the bank name clearly.',
          needsBankSelection: true
        };
      }

      // Step 2: Validate account with Paystack
      console.log(`Step 2: Validating account ${account_number} with ${finalBankName} (${finalBankCode})`);
      
      let accountInfo;
      try {
        accountInfo = await this.paystack.resolveBankAccount(account_number,finalBankCode);
        console.log('Paystack response:', accountInfo);
      } catch (paystackError) {
        console.error('Paystack resolve error:', paystackError);
        
        // More specific error handling
        const errorMessage = paystackError.message || '';
        
        if (errorMessage.includes('Could not resolve account name') || 
            errorMessage.includes('Invalid account number')) {
          return {
            success: false,
            message: `❌ Could not verify account number ${account_number} with ${finalBankName}.\n\n🔍 Please check:\n• Account number is correct (11 digits for Opay)\n• Bank name is correct\n• Account exists and is active`,
            paystackError: true
          };
        }
        
        if (errorMessage.includes('Invalid bank code')) {
          return {
            success: false,
            message: `❌ Invalid bank code for ${finalBankName}. This might be a system issue.`,
            needsBankSelection: true
          };
        }

        return {
          success: false,
          message: `❌ Account verification failed: ${errorMessage}\n\n💡 This might be a temporary issue. Please try again in a few moments.`,
          paystackError: true
        };
      }
      
      if (!accountInfo || !accountInfo.account_name) {
        console.log('No account info received:', accountInfo);
        return {
          success: false,
          message: '❌ Could not retrieve account details. The account might not exist or be inactive.',
          paystackError: true
        };
      }

      console.log(`Account verified: ${accountInfo.account_name}`);

      // Step 3: Check for duplicates
      console.log('Step 3: Checking for duplicate nickname');
      const { data: existing } = await this.supabase
        .from('beneficiaries')
        .select('id')
        .eq('user_id', userId)
        .eq('nickname', nickname.toLowerCase())
        .single();

      if (existing) {
        console.log(`Duplicate nickname found: ${nickname}`);
        return {
          success: false,
          message: `❌ You already have a beneficiary named "${nickname}". Please choose a different nickname like "${nickname}2" or "${nickname}_${finalBankName.split(' ')[0].toLowerCase()}".`,
          duplicateNickname: true
        };
      }

      console.log('Step 4: Checking for duplicate account');
      const { data: existingAccount } = await this.supabase
        .from('beneficiaries')
        .select('nickname, account_name')
        .eq('user_id', userId)
        .eq('account_number', account_number)
        .single();

      if (existingAccount) {
        console.log(`Duplicate account found: ${account_number}`);
        return {
          success: false,
          message: `❌ This account (${existingAccount.account_name}) is already saved as "${existingAccount.nickname}".`,
          duplicateAccount: true
        };
      }

      // Step 5: Add beneficiary
      console.log('Step 5: Adding beneficiary to database');
      const { data, error } = await this.supabase
        .from('beneficiaries')
        .insert({
          user_id: userId,
          nickname: nickname.toLowerCase(),
          account_number,
          account_name: accountInfo.account_name,
          bank_name: finalBankName,
          bank_code: finalBankCode
        })
        .select()
        .single();

      if (error) {
        console.error('Database insert error:', error);
        throw error;
      }

      console.log('Beneficiary added successfully:', data);
      return {
        success: true,
        message: `✅ ${accountInfo.account_name} has been successfully added as "${nickname}"!\n\n🎉 You can now send money by saying: "Send ₦5000 to ${nickname}"`,
        beneficiary: data
      };

    } catch (error) {
      console.error('Add beneficiary unexpected error:', error);
      return {
        success: false,
        message: `❌ An unexpected error occurred: ${error.message}\n\n💡 Please try again or contact support if this persists.`,
        beneficiary: null
      };
    }
  }

  // Debug method to test bank resolution
  async testBankResolution(bankName) {
    console.log(`=== Testing Bank Resolution for "${bankName}" ===`);
    const result = await this.findBankByName(bankName);
    
    if (result) {
      console.log(`✅ Found: ${result.name} (Code: ${result.code})`);
      return result;
    } else {
      console.log(`❌ Not found: "${bankName}"`);
      return null;
    }
  }

  // Rest of your existing methods...
  async getBeneficiaries(userId) {
    try {
      const { data, error } = await this.supabase
        .from('beneficiaries')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return { success: true, beneficiaries: data || [] };
    } catch (error) {
      console.error('Get beneficiaries error:', error);
      return { success: false, message: 'Failed to retrieve beneficiaries.', beneficiaries: [] };
    }
  }

  formatBeneficiariesList(beneficiaries) {
    if (!beneficiaries || beneficiaries.length === 0) {
      return "You don't have any saved beneficiaries yet. You can add one by sharing account details! 📝\n\n💡 Try: 'Add mom 09012345678 Opay as mom'";
    }

    let response = "📋 Your Saved Beneficiaries:\n\n";
    beneficiaries.forEach((beneficiary, index) => {
      response += `${index + 1}. **${beneficiary.nickname.toUpperCase()}**\n`;
      response += `   ${beneficiary.account_name}\n`;
      response += `   ${beneficiary.account_number} - ${beneficiary.bank_name}\n\n`;
    });

    response += "💸 Send money by saying: 'Send ₦5000 to mom' or 'Transfer 2000 to john'";
    return response;
  }
}

export default EnhancedBeneficiaryService;