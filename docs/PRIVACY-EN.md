# Privacy Policy — WhatsApp Business Platform (Paid Version)

> Preliminary draft for legal review — have it approved by qualified counsel before publishing.

**Last updated: November 2026**

## 1. Who processes your data?
The Platform is sold as a self-contained copy that runs on the Customer's (buyer's) own hosting. Therefore:
- **The Customer (copy owner)** is the data controller for their own customers and contacts whose data passes through their copy.
- **The Seller (Platform developer)** does not host, access, or collect any data from the Customer's copy in normal operation, and collects no usage analytics from it.

## 2. Data the Platform stores locally in the Customer's copy
- Inbound and outbound conversations and messages (text and media) with sender numbers.
- Contacts uploaded by the Customer (names, numbers, labels).
- Templates, campaigns and delivery results.
- Staff accounts (username and scrypt-hashed password).
- Meta connection settings (stored locally; access tokens are masked in the UI and excluded from backups).

## 3. Data shared with third parties
- **Meta Platforms**: all messages transit the WhatsApp Business API and are subject to Meta's privacy policy and terms.
- **The hosting provider** chosen by the Customer (e.g. Render) hosts the copy's database.
- The Platform sends no analytics or tracking data to the Seller or anyone else.

## 4. Activation
During activation the copy shows a technical "installation code" (a random, non-personal identifier) that the Customer sends to the Seller to receive an activation code. The installation code contains no personal data.

## 5. Individual Rights
The Customer, as data controller, must respond to their own customers' data requests (access, correction, deletion, opt-out). The Platform provides tools to delete conversations, block numbers (unsubscribe) and export data.

## 6. Security
- Staff passwords are hashed and never included in exports.
- Meta access tokens are masked (last 4 characters only) and excluded from backups.
- Additional protection: temporary lockout after repeated failed logins.
- Customers are advised to enforce HTTPS and restrict access to authorized staff.

## 7. Data Retention
Data remains in the Customer's copy for as long as it operates. The Customer sets their own deletion policy. To dispose of everything, delete the copy's data directory.

## 8. Changes
This policy may be updated as the Platform evolves; the latest version ships with updates.
