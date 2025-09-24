class ReportService {
  constructor(supabaseClient) {
    this.supabase = supabaseClient;
  }

  async generateMonthlyReport(userId) {
    const now = new Date();
    const month = now.getMonth(); // Previous month
    const year = now.getFullYear();
    
    // If it's January, get December of previous year
    const reportMonth = month === 0 ? 12 : month;
    const reportYear = month === 0 ? year - 1 : year;

    try {
      // Get transactions for the month
      const startDate = new Date(reportYear, reportMonth - 1, 1);
      const endDate = new Date(reportYear, reportMonth, 0, 23, 59, 59);

      const { data: transactions } = await this.supabase
        .from('transactions')
        .select('*')
        .eq('user_id', userId)
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString());

      // Calculate totals
      let totalIncome = 0;
      let totalExpenses = 0;

      transactions.forEach(txn => {
        if (txn.type === 'credit') {
          totalIncome += parseFloat(txn.amount);
        } else {
          totalExpenses += parseFloat(txn.amount) + parseFloat(txn.service_fee);
        }
      });

      // Save report
      const reportData = {
        user_id: userId,
        month: reportMonth,
        year: reportYear,
        total_income: totalIncome,
        total_expenses: totalExpenses,
        transaction_count: transactions.length
      };

      const { data: report } = await this.supabase
        .from('monthly_reports')
        .upsert([reportData])
        .select()
        .single();

      return report;
    } catch (error) {
      console.error('Generate monthly report error:', error);
      throw error;
    }
  }

  async generateFinancialAdvice(report) {
    const { total_income, total_expenses, transaction_count } = report;
    const netAmount = total_income - total_expenses;
    const spendingRatio = total_income > 0 ? (total_expenses / total_income) * 100 : 0;

    let advice = '';

    if (spendingRatio > 90) {
      advice = `🚨 High Spending Alert!\n\n` +
        `You've spent ${spendingRatio.toFixed(1)}% of your income this month. ` +
        `Consider reviewing your expenses and creating a budget to save more.`;
    } else if (spendingRatio > 70) {
      advice = `⚠️ Moderate Spending\n\n` +
        `You've spent ${spendingRatio.toFixed(1)}% of your income. ` +
        `You're doing okay, but there's room for improvement in saving.`;
    } else if (spendingRatio > 50) {
      advice = `✅ Good Financial Health\n\n` +
        `You've spent ${spendingRatio.toFixed(1)}% of your income. ` +
        `Great job maintaining a balanced spending pattern!`;
    } else {
      advice = `🎉 Excellent Savings!\n\n` +
        `You've only spent ${spendingRatio.toFixed(1)}% of your income. ` +
        `Outstanding financial discipline! Keep up the great work.`;
    }

    if (transaction_count > 50) {
      advice += `\n\n💡 With ${transaction_count} transactions this month, ` +
        `consider using budgeting categories to track your spending better.`;
    }

    if (netAmount < 0) {
      advice += `\n\n📊 You spent ₦${Math.abs(netAmount).toLocaleString()} ` +
        `more than you earned. Focus on increasing income or reducing expenses.`;
    } else if (netAmount > 0) {
      advice += `\n\n🎯 You saved ₦${netAmount.toLocaleString()} this month. ` +
        `Consider investing this surplus for long-term growth.`;
    }

    return advice;
  }
}

export default ReportService;