# Eco Screen Quotation System MVP

A simple local quotation system for a Malaysian screen / security mesh company.

## What It Does

- Customer details
- Multiple quotation items
- Automatic sqft conversion from mm
- Minimum chargeable sqft:
  - Window products: 11 sqft
  - Door products: 21 sqft
- Editable product prices
- Total, deposit, and balance calculation
- Printable quotation for PDF saving
- One-click WhatsApp message copy
- Browser localStorage data
- Dashboard for quote count, monthly amount, pending balance, top product, and top area
- Professional quotation number, for example `ESQ-2026-0001`
- Quote status tracking:
  - Quoted
  - Follow Up
  - Won
  - Cancelled
- Edit old quotations
- Delete quotations
- Dashboard conversion rate by won quotations
- Convert won orders into production sheets and installation sheets
- Production sheet status tracking
- Mobile-friendly installation team checklist
- Customer finger signature saved in browser localStorage
- Installation completion records
- Payment management for each order with multiple payment records
- Boss Dashboard for sales, collection, pending balance, unpaid orders, overdue orders, top product, and top area
- Pending Balance page with one-click WhatsApp follow-up copy

## Run Locally

1. Install Node.js from https://nodejs.org
2. Open this project folder in a terminal.
3. Install the project:

```bash
npm install
```

4. Start the system:

```bash
npm run dev
```

5. Open:

```text
http://localhost:3000
```

## Save PDF

Click **Download PDF**. The browser print window will open. Choose **Save as PDF**.

## Edit Or Delete Quotes

Saved quotations appear in **Quote History**. Click **Edit** to load a quotation back into the form, then click **Update Quote** after making changes. Click **Delete** to remove a quotation from this browser.

## Production And Installation Flow

1. Create a quotation.
2. Change the quotation status to **Won**.
3. Fill installation date and installation notes.
4. Click **Convert to Order**.
5. In **Orders Page**, click **Generate Production** and **Generate Installation**.
6. Update production details in **Production Sheets**.
7. The installation team can use **Installation Team Page** on mobile, tick the checklist, collect customer signature, and click **Generate Completion Record**.

## Payment Management

1. Convert a won quotation into an order.
2. Go to **Orders Page**.
3. Add payment records such as Deposit, second payment, and final balance.
4. The system calculates paid amount, unpaid amount, and payment status automatically.
5. Go to **Pending Balance Page** to see all unpaid orders and copy a WhatsApp follow-up message.

## Roles And Menus

- **Admin**: all features, financial dashboard, pending balance, profit analysis, settings.
- **Sales**: quotation, customer, follow up, order.
- **Production**: production order and production status only.
- **Installer**: installation order, customer signature, collection record only.

Production and Installer roles do not show product pricing, quotation totals, cost, or profit pages.

## CRM Follow Up

1. Create at least one quotation or order.
2. Open **Sales** or **Admin**.
3. Go to **Customer**.
4. Set follow-up date, follow-up note, and customer status.
5. Go to **Follow Up** to see customers due today or customers that need follow-up.
6. Customers with no follow-up for more than 7 days are shown as **Need Follow Up** automatically.

## Warranty

1. Generate an installation sheet.
2. Complete the installation and click **Generate Completion Record**.
3. Warranty cards are created automatically.
4. Open **Warranty** under Admin or Sales.
5. Search warranty records by customer phone number.

Warranty periods:
- Security Mesh: 10 years
- Roller: 3 years
- Sliding / Pocket Lock / 3 Section: 5 years
- Magnetic: 1 year

## Data Storage

This MVP stores product prices and saved quotations in the same browser using localStorage. It does not need login, server, or database.
