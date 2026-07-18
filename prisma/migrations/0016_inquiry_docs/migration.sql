-- Pre-quotation documents (Inquiry Form, RFQ/BOQ) attached to an inquiry.
ALTER TABLE "Inquiry" ADD COLUMN "docs" JSONB NOT NULL DEFAULT '{}';
