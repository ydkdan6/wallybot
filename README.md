# SecurePay Wallet - Telegram Bot Financial System

A comprehensive financial management system with web authentication and AI-powered Telegram bot integration.

## Features

### 🔐 Authentication System
- Secure user registration with encrypted transaction PINs
- Supabase authentication with custom user profiles
- Automatic Telegram bot linking after registration

### 🤖 AI-Powered Telegram Bot
- **Natural Language Processing** with Google Gemini AI
- **Conversational Interface** - users can interact naturally
- **Smart Intent Recognition** for financial transactions
- **OCR Integration** for account number recognition from images

### 💰 Financial Services
- **Virtual Wallet Creation** via Paystack integration
- **Instant Wallet Funding** through dedicated virtual accounts
- **Money Transfers** with secure PIN verification
- **Real-time Balance Checks**
- **Transaction History** with detailed records

### 📊 Advanced Features
- **Automated Service Fees** (₦10 per transaction)
- **PDF Receipt Generation** for all transactions
- **Monthly Financial Reports** with AI-generated advice
- **OCR Account Recognition** from uploaded images
- **Real-time Webhook Processing** for instant notifications

## Setup Instructions

### 1. Environment Configuration

Create a `.env` file with the following variables:

```env
# Supabase
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Telegram Bot
TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather

# Paystack
PAYSTACK_SECRET_KEY=your_paystack_secret_key

# Google Gemini AI
GEMINI_API_KEY=your_gemini_api_key

# OCR Service
OCR_API_KEY=your_rapidapi_ocr_key
```

### 2. Database Setup

The system automatically creates the required database schema when you connect to Supabase. The migration file includes:

- **users** table with encrypted PIN storage
- **transactions** table for financial records
- **monthly_reports** table for automated reporting
- Proper Row Level Security (RLS) policies
- Performance-optimized indexes

### 3. Telegram Bot Setup

1. Create a bot with [@BotFather](https://t.me/botfather)
2. Get your bot token
3. Set the webhook URL for Paystack notifications
4. Configure bot permissions for file uploads (OCR feature)

### 4. Paystack Configuration

1. Create a [Paystack](https://paystack.com) account
2. Get your secret key from the dashboard
3. Configure webhooks to point to your server
4. Ensure NGN currency support is enabled

### 5. AI Services Setup

1. **Google Gemini**: Get API key from [Google AI Studio](https://makersuite.google.com)
2. **OCR Service**: Subscribe to the OCR API on [RapidAPI](https://rapidapi.com/hub)

## Installation & Running

### Frontend (Authentication Page)
```bash
npm install
npm run dev
```

### Backend (Telegram Bot)
```bash
npm run bot
```

## Architecture Overview

### Frontend Components
- **AuthPage**: Secure registration form with validation
- **Responsive Design**: Mobile-optimized interface
- **Real-time Validation**: Instant form feedback

### Backend Services
- **PaystackService**: Virtual account and customer management
- **ReceiptService**: PDF generation for transactions
- **ReportService**: Monthly financial analysis
- **OCRService**: Image text extraction and account recognition
- **NLPService**: AI-powered message understanding

### Database Schema
- Properly normalized tables with foreign key constraints
- Encrypted sensitive data (PINs, personal information)
- Comprehensive audit trails for all transactions
- Performance-optimized indexes

## API Integration

### Paystack Integration
- Customer creation and management
- Dedicated virtual account generation
- Transaction verification and webhook processing
- Bank account resolution

### Telegram Bot API
- Message processing and response handling
- File upload processing for OCR
- Interactive keyboard creation
- Real-time notification delivery

### Google Gemini AI
- Natural language understanding
- Intent classification for financial requests
- Conversational response generation
- Financial advice generation

## Security Features

- **End-to-End Encryption** for transaction PINs
- **Row Level Security** in database
- **Webhook Signature Verification** for Paystack
- **Input Sanitization** for all user data
- **Rate Limiting** for API calls
- **Secure File Handling** for OCR uploads

## User Journey

1. **Registration**: User creates account via web interface
2. **Bot Linking**: Automatic redirect to Telegram bot
3. **Wallet Setup**: Virtual account creation via Paystack
4. **Funding**: User receives virtual account details for funding
5. **Transactions**: AI-powered conversational interface for transfers
6. **Receipts**: Automatic PDF receipt generation
7. **Reports**: Monthly financial insights and advice

## Monitoring & Analytics

- Transaction success/failure rates
- User engagement metrics
- AI intent recognition accuracy
- System performance monitoring
- Financial report generation

## Support & Maintenance

The system includes comprehensive error handling, logging, and monitoring to ensure reliable operation. Monthly reports provide insights into user spending patterns and system usage.

## License

This project is proprietary software. All rights reserved.