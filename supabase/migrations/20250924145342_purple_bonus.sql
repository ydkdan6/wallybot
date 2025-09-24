/*
  # Financial Management System Database Schema

  1. New Tables
    - `users`
      - `id` (uuid, primary key)
      - `email` (text, unique)
      - `first_name` (text)
      - `last_name` (text)
      - `phone_number` (text, unique)
      - `date_of_birth` (date)
      - `transaction_pin` (text, encrypted)
      - `telegram_chat_id` (text, unique, nullable)
      - `paystack_customer_code` (text, unique, nullable)
      - `virtual_account_number` (text, unique, nullable)
      - `virtual_account_name` (text, nullable)
      - `wallet_balance` (decimal, default 0)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)

    - `transactions`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to users)
      - `type` (text: 'credit', 'debit', 'transfer')
      - `amount` (decimal)
      - `service_fee` (decimal, default 10)
      - `recipient_account` (text, nullable)
      - `recipient_name` (text, nullable)
      - `description` (text)
      - `reference` (text, unique)
      - `status` (text: 'pending', 'completed', 'failed')
      - `created_at` (timestamp)

    - `monthly_reports`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to users)
      - `month` (integer)
      - `year` (integer)
      - `total_income` (decimal)
      - `total_expenses` (decimal)
      - `transaction_count` (integer)
      - `generated_at` (timestamp)

  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated users to access their own data
    - Implement proper indexing for performance
*/

-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  phone_number text UNIQUE NOT NULL,
  date_of_birth date NOT NULL,
  transaction_pin text NOT NULL,
  telegram_chat_id text UNIQUE,
  paystack_customer_code text UNIQUE,
  virtual_account_number text UNIQUE,
  virtual_account_name text,
  wallet_balance decimal(15,2) DEFAULT 0.00,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create transactions table
CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('credit', 'debit', 'transfer')),
  amount decimal(15,2) NOT NULL,
  service_fee decimal(15,2) DEFAULT 10.00,
  recipient_account text,
  recipient_name text,
  description text,
  reference text UNIQUE NOT NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  created_at timestamptz DEFAULT now()
);

-- Create monthly_reports table
CREATE TABLE IF NOT EXISTS monthly_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month integer NOT NULL,
  year integer NOT NULL,
  total_income decimal(15,2) DEFAULT 0.00,
  total_expenses decimal(15,2) DEFAULT 0.00,
  transaction_count integer DEFAULT 0,
  generated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, month, year)
);

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_reports ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can read own data"
  ON users
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own data"
  ON users
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can read own transactions"
  ON transactions
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own transactions"
  ON transactions
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can read own reports"
  ON monthly_reports
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own reports"
  ON monthly_reports
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number);
CREATE INDEX IF NOT EXISTS idx_users_telegram ON users(telegram_chat_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_reference ON transactions(reference);
CREATE INDEX IF NOT EXISTS idx_reports_user_date ON monthly_reports(user_id, year, month);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for users table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_users_updated_at'
  ) THEN
    CREATE TRIGGER update_users_updated_at
      BEFORE UPDATE ON users
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;