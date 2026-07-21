-- Add an "OTHER" base app-access role for staff who are neither Sales nor
-- Engineers (e.g. an Approver / Accountant) so they can sign in; their abilities
-- come from their assigned workflow roles. Idempotent.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'OTHER';
