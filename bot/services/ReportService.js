class ReportService {
  constructor(supabaseClient) {
    this.supabase = supabaseClient;
  }

  async generateMonthlyReport(userId, specificMonth = null, specificYear = null) {
    const now = new Date();
    let reportMonth, reportYear;

    if (specificMonth && specificYear) {
      reportMonth = specificMonth;
      reportYear = specificYear;
    } else {
      // Default to previous month
      const month = now.getMonth();
      const year = now.getFullYear();
      
      // If it's January, get December of previous year
      reportMonth = month === 0 ? 12 : month;
      reportYear = month === 0 ? year - 1 : year;
    }

    try {
      // Get transactions for the month
      const startDate = new Date(reportYear, reportMonth - 1, 1);
      const endDate = new Date(reportYear, reportMonth, 0, 23, 59, 59);

      const { data: transactions, error: transactionError } = await this.supabase
        .from('transactions')
        .select('*')
        .eq('user_id', userId)
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString())
        .order('created_at', { ascending: false });

      if (transactionError) {
        throw new Error(`Failed to fetch transactions: ${transactionError.message}`);
      }

      // Calculate totals and categorize transactions
      let totalIncome = 0;
      let totalExpenses = 0;
      let totalServiceFees = 0;
      const transactionsByType = {
        credit: [],
        debit: [],
        transfer: []
      };

      (transactions || []).forEach(txn => {
        const amount = parseFloat(txn.amount) || 0;
        const serviceFee = parseFloat(txn.service_fee) || 0;
        
        transactionsByType[txn.type]?.push(txn);
        
        if (txn.type === 'credit') {
          totalIncome += amount;
        } else {
          totalExpenses += amount;
          totalServiceFees += serviceFee;
        }
      });

      // Calculate additional metrics
      const netAmount = totalIncome - totalExpenses - totalServiceFees;
      const spendingRatio = totalIncome > 0 ? ((totalExpenses + totalServiceFees) / totalIncome) * 100 : 0;
      const avgTransactionAmount = transactions?.length > 0 
        ? (totalIncome + totalExpenses) / transactions.length 
        : 0;

      // Save report with additional metrics
      const reportData = {
        user_id: userId,
        month: reportMonth,
        year: reportYear,
        total_income: totalIncome,
        total_expenses: totalExpenses,
        total_service_fees: totalServiceFees,
        net_amount: netAmount,
        spending_ratio: spendingRatio,
        transaction_count: transactions?.length || 0,
        avg_transaction_amount: avgTransactionAmount,
        credit_count: transactionsByType.credit.length,
        debit_count: transactionsByType.debit.length,
        transfer_count: transactionsByType.transfer.length,
        generated_at: new Date().toISOString()
      };

      const { data: report, error: reportError } = await this.supabase
        .from('monthly_reports')
        .upsert([reportData], { onConflict: 'user_id,month,year' })
        .select()
        .single();

      if (reportError) {
        throw new Error(`Failed to save report: ${reportError.message}`);
      }

      // Add raw transactions to report for detailed analysis
      return {
        ...report,
        transactions: transactions || [],
        transactionsByType
      };

    } catch (error) {
      console.error('Generate monthly report error:', error);
      throw error;
    }
  }

  async generateFinancialAdvice(report) {
    const { 
      total_income, 
      total_expenses, 
      total_service_fees,
      transaction_count, 
      net_amount,
      spending_ratio,
      avg_transaction_amount,
      credit_count,
      debit_count 
    } = report;

    let advice = '';
    const totalSpent = total_expenses + total_service_fees;

    // Primary spending analysis
    if (spending_ratio > 90) {
      advice = `🚨 High Spending Alert!\n\n` +
        `You've spent ${spending_ratio.toFixed(1)}% of your income this month (₦${totalSpent.toLocaleString()}). ` +
        `This leaves very little room for savings. Consider reviewing your expenses and creating a strict budget.`;
    } else if (spending_ratio > 70) {
      advice = `⚠️ Moderate Spending\n\n` +
        `You've spent ${spending_ratio.toFixed(1)}% of your income (₦${totalSpent.toLocaleString()}). ` +
        `You're doing okay, but there's room for improvement in saving more for the future.`;
    } else if (spending_ratio > 50) {
      advice = `✅ Good Financial Health\n\n` +
        `You've spent ${spending_ratio.toFixed(1)}% of your income (₦${totalSpent.toLocaleString()}). ` +
        `Great job maintaining a balanced spending pattern!`;
    } else if (spending_ratio > 0) {
      advice = `🎉 Excellent Savings!\n\n` +
        `You've only spent ${spending_ratio.toFixed(1)}% of your income (₦${totalSpent.toLocaleString()}). ` +
        `Outstanding financial discipline! Keep up the great work.`;
    } else {
      advice = `💰 No Expenses Recorded\n\n` +
        `Interesting! You had income but no recorded expenses this month. ` +
        `Make sure all transactions are being tracked properly.`;
    }

    // Transaction frequency analysis
    if (transaction_count > 100) {
      advice += `\n\n📊 High Transaction Volume: With ${transaction_count} transactions ` +
        `(avg: ₦${avg_transaction_amount.toLocaleString()} each), consider consolidating ` +
        `smaller purchases to reduce service fees.`;
    } else if (transaction_count > 50) {
      advice += `\n\n💡 Active Usage: ${transaction_count} transactions this month. ` +
        `Consider using budgeting categories to track your spending patterns better.`;
    } else if (transaction_count < 5 && transaction_count > 0) {
      advice += `\n\n🤔 Low Activity: Only ${transaction_count} transactions this month. ` +
        `If you're using other payment methods, consider consolidating through your wallet for better tracking.`;
    }

    // Service fees analysis
    if (total_service_fees > 0) {
      const feePercentage = total_income > 0 ? (total_service_fees / total_income) * 100 : 0;
      if (feePercentage > 5) {
        advice += `\n\n💸 High Service Fees: You paid ₦${total_service_fees.toLocaleString()} ` +
          `in fees (${feePercentage.toFixed(1)}% of income). Look for ways to reduce transaction costs.`;
      } else if (feePercentage > 2) {
        advice += `\n\n💳 Service Fees: ₦${total_service_fees.toLocaleString()} in fees this month. ` +
          `Consider batching smaller transactions to minimize costs.`;
      }
    }

    // Net amount analysis
    if (net_amount < 0) {
      advice += `\n\n📉 Deficit Alert: You spent ₦${Math.abs(net_amount).toLocaleString()} ` +
        `more than you earned. Focus on increasing income or reducing non-essential expenses.`;
    } else if (net_amount > 0) {
      const savingsRate = total_income > 0 ? (net_amount / total_income) * 100 : 0;
      advice += `\n\n🎯 Savings Achievement: You saved ₦${net_amount.toLocaleString()} ` +
        `(${savingsRate.toFixed(1)}% savings rate). Consider investing this surplus for long-term growth.`;
    }

    // Transaction pattern insights
    if (credit_count > 0 && debit_count > 0) {
      const creditDebitRatio = credit_count / debit_count;
      if (creditDebitRatio < 0.3) {
        advice += `\n\n⚡ Spending Pattern: You have many more outgoing (${debit_count}) than ` +
          `incoming (${credit_count}) transactions. Focus on increasing income sources.`;
      }
    }

    return advice;
  }

  async getUserReportHistory(userId, limit = 12) {
    try {
      const { data: reports, error } = await this.supabase
        .from('monthly_reports')
        .select('*')
        .eq('user_id', userId)
        .order('year', { ascending: false })
        .order('month', { ascending: false })
        .limit(limit);

      if (error) {
        throw new Error(`Failed to fetch report history: ${error.message}`);
      }

      return reports || [];
    } catch (error) {
      console.error('Get user report history error:', error);
      throw error;
    }
  }

  async compareWithPreviousMonth(currentReport) {
    try {
      const { user_id, month, year } = currentReport;
      let prevMonth = month - 1;
      let prevYear = year;

      if (prevMonth === 0) {
        prevMonth = 12;
        prevYear = year - 1;
      }

      const { data: previousReport } = await this.supabase
        .from('monthly_reports')
        .select('*')
        .eq('user_id', user_id)
        .eq('month', prevMonth)
        .eq('year', prevYear)
        .single();

      if (!previousReport) {
        return "No previous month data available for comparison.";
      }

      const incomeChange = currentReport.total_income - previousReport.total_income;
      const expenseChange = currentReport.total_expenses - previousReport.total_expenses;
      const incomeChangePercent = previousReport.total_income > 0 
        ? (incomeChange / previousReport.total_income) * 100 
        : 0;
      const expenseChangePercent = previousReport.total_expenses > 0 
        ? (expenseChange / previousReport.total_expenses) * 100 
        : 0;

      let comparison = `📈 Month-over-Month Comparison:\n\n`;

      // Income comparison
      if (incomeChange > 0) {
        comparison += `💰 Income increased by ₦${incomeChange.toLocaleString()} (+${incomeChangePercent.toFixed(1)}%)\n`;
      } else if (incomeChange < 0) {
        comparison += `📉 Income decreased by ₦${Math.abs(incomeChange).toLocaleString()} (${incomeChangePercent.toFixed(1)}%)\n`;
      } else {
        comparison += `➡️ Income remained the same\n`;
      }

      // Expense comparison
      if (expenseChange > 0) {
        comparison += `📈 Expenses increased by ₦${expenseChange.toLocaleString()} (+${expenseChangePercent.toFixed(1)}%)\n`;
      } else if (expenseChange < 0) {
        comparison += `📉 Expenses decreased by ₦${Math.abs(expenseChange).toLocaleString()} (${expenseChangePercent.toFixed(1)}%)\n`;
      } else {
        comparison += `➡️ Expenses remained the same\n`;
      }

      return comparison;

    } catch (error) {
      console.error('Compare with previous month error:', error);
      return "Unable to compare with previous month data.";
    }
  }
}

export default ReportService;