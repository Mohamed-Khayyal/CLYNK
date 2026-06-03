USE CLYNK;
GO

ALTER TABLE dbo.Clinics
ALTER COLUMN location NVARCHAR(150) NULL;
GO

DECLARE @doctorLicenseConstraint SYSNAME;
DECLARE @sql NVARCHAR(MAX);

SELECT TOP 1 @doctorLicenseConstraint = kc.name
FROM sys.key_constraints kc
JOIN sys.index_columns ic
  ON ic.object_id = kc.parent_object_id
 AND ic.index_id = kc.unique_index_id
JOIN sys.columns c
  ON c.object_id = ic.object_id
 AND c.column_id = ic.column_id
WHERE kc.parent_object_id = OBJECT_ID('dbo.Doctors')
  AND kc.type = 'UQ'
  AND c.name = 'license_number';

IF @doctorLicenseConstraint IS NOT NULL
BEGIN
    SET @sql = N'ALTER TABLE dbo.Doctors DROP CONSTRAINT [' + @doctorLicenseConstraint + N']';
    EXEC sp_executesql @sql;
END
GO

IF EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.Doctors')
      AND name = 'UX_Doctors_LicenseNumber'
)
BEGIN
    DROP INDEX UX_Doctors_LicenseNumber ON dbo.Doctors;
END
GO

ALTER TABLE dbo.Doctors
ALTER COLUMN license_number VARCHAR(50) NULL;
GO

ALTER TABLE dbo.Doctors
ALTER COLUMN specialist NVARCHAR(100) NULL;
GO

ALTER TABLE dbo.Doctors
ALTER COLUMN work_days NVARCHAR(100) NULL;
GO

ALTER TABLE dbo.Doctors
ALTER COLUMN work_from TIME NULL;
GO

ALTER TABLE dbo.Doctors
ALTER COLUMN work_to TIME NULL;
GO

CREATE UNIQUE INDEX UX_Doctors_LicenseNumber
ON dbo.Doctors(license_number)
WHERE license_number IS NOT NULL;
GO

