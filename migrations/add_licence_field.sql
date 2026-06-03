-- ============================================================
-- Migration: Add `licence` file URL field to Doctors, Staff,
--            and Clinics; drop old text-based license_number.
-- Run this script once against the CLYNK database.
-- ============================================================

USE CLYNK;
GO

-- 1. Drop the unique index on license_number (Doctors)
IF EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'UX_Doctors_LicenseNumber'
      AND object_id = OBJECT_ID('dbo.Doctors')
)
BEGIN
    DROP INDEX UX_Doctors_LicenseNumber ON dbo.Doctors;
    PRINT 'Dropped index UX_Doctors_LicenseNumber';
END
GO

-- 2. Drop the license_number column from Doctors
IF COL_LENGTH('dbo.Doctors', 'license_number') IS NOT NULL
BEGIN
    ALTER TABLE dbo.Doctors DROP COLUMN license_number;
    PRINT 'Dropped column license_number from dbo.Doctors';
END
GO

-- 3. Add licence URL column to Doctors (nullable, PDF or image URL)
IF COL_LENGTH('dbo.Doctors', 'licence') IS NULL
BEGIN
    ALTER TABLE dbo.Doctors ADD licence VARCHAR(500) NULL;
    PRINT 'Added column licence to dbo.Doctors';
END
GO

-- 4. Add licence URL column to Staff (nullable)
IF COL_LENGTH('dbo.Staff', 'licence') IS NULL
BEGIN
    ALTER TABLE dbo.Staff ADD licence VARCHAR(500) NULL;
    PRINT 'Added column licence to dbo.Staff';
END
GO

-- 5. Add licence URL column to Clinics (nullable)
IF COL_LENGTH('dbo.Clinics', 'licence') IS NULL
BEGIN
    ALTER TABLE dbo.Clinics ADD licence VARCHAR(500) NULL;
    PRINT 'Added column licence to dbo.Clinics';
END
GO

PRINT 'Migration add_licence_field completed successfully.';
GO
