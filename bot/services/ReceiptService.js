const fs = require('fs');
const path = require('path');
const PDFKit = require('pdfkit');

class ReceiptService {
  constructor() {
    this.ensureDirectoryExists();
  }

  ensureDirectoryExists() {
    const receiptsDir = path.join(__dirname, '../receipts');
    if (!fs.existsSync(receiptsDir)) {
      fs.mkdirSync(receiptsDir, { recursive: true });
    }
  }

  async generateReceipt(transaction, user) {
    return new Promise((resolve, reject) => {
      try {
        const filename = `receipt_${transaction.reference}.pdf`;
        const filepath = path.join(__dirname, '../receipts', filename);
        
        const doc = new PDFKit();
        doc.pipe(fs.createWriteStream(filepath));

        // Header
        doc.fontSize(20)
           .fillColor('#2563eb')
           .text('SecurePay Wallet', 50, 50, { align: 'center' });
           
        doc.fontSize(16)
           .fillColor('#6b7280')
           .text('Transaction Receipt', 50, 80, { align: 'center' });

        // Draw line
        doc.moveTo(50, 120)
           .lineTo(550, 120)
           .stroke('#e5e7eb');

        // Transaction Details
        doc.fontSize(12)
           .fillColor('#111827')
           .text('Transaction Details', 50, 140, { underline: true });

        const details = [
          ['Reference:', transaction.reference],
          ['Date:', new Date(transaction.created_at).toLocaleString()],
          ['Type:', transaction.type.toUpperCase()],
          ['Amount:', `₦${parseFloat(transaction.amount).toLocaleString()}`],
          ['Service Fee:', `₦${parseFloat(transaction.service_fee).toLocaleString()}`],
          ['Total:', `₦${(parseFloat(transaction.amount) + parseFloat(transaction.service_fee)).toLocaleString()}`],
          ['Status:', transaction.status.toUpperCase()]
        ];

        if (transaction.recipient_account) {
          details.push(['Recipient Account:', transaction.recipient_account]);
          details.push(['Recipient Name:', transaction.recipient_name || 'N/A']);
        }

        let yPosition = 170;
        details.forEach(([label, value]) => {
          doc.fillColor('#6b7280')
             .text(label, 50, yPosition, { width: 150 });
          doc.fillColor('#111827')
             .text(value, 200, yPosition);
          yPosition += 25;
        });

        // User Details
        yPosition += 30;
        doc.fontSize(12)
           .fillColor('#111827')
           .text('Account Holder', 50, yPosition, { underline: true });

        yPosition += 30;
        const userDetails = [
          ['Name:', `${user.first_name} ${user.last_name}`],
          ['Email:', user.email],
          ['Phone:', user.phone_number],
          ['Virtual Account:', user.virtual_account_number || 'N/A']
        ];

        userDetails.forEach(([label, value]) => {
          doc.fillColor('#6b7280')
             .text(label, 50, yPosition, { width: 150 });
          doc.fillColor('#111827')
             .text(value, 200, yPosition);
          yPosition += 25;
        });

        // Footer
        doc.fontSize(10)
           .fillColor('#9ca3af')
           .text('This is an electronically generated receipt.', 50, 700, { align: 'center' })
           .text('SecurePay Wallet - Your Trusted Financial Partner', 50, 720, { align: 'center' });

        doc.end();

        doc.on('end', () => {
          resolve(filepath);
        });

        doc.on('error', (error) => {
          reject(error);
        });

      } catch (error) {
        reject(error);
      }
    });
  }
}

export default ReceiptService;