USE CLYNK;
GO

IF OBJECT_ID('dbo.CK_Staff_Doctor_Data', 'C') IS NOT NULL
BEGIN
    ALTER TABLE dbo.Staff
    DROP CONSTRAINT CK_Staff_Doctor_Data;
END
GO

DECLARE @roleTitleConstraint SYSNAME;
DECLARE @sql NVARCHAR(MAX);

SELECT TOP 1 @roleTitleConstraint = cc.name
FROM sys.check_constraints cc
WHERE cc.parent_object_id = OBJECT_ID('dbo.Staff')
  AND cc.definition LIKE '%role_title%';

IF @roleTitleConstraint IS NOT NULL
BEGIN
    SET @sql = N'ALTER TABLE dbo.Staff DROP CONSTRAINT [' + @roleTitleConstraint + N']';
    EXEC sp_executesql @sql;
END
GO

IF COL_LENGTH('dbo.Staff', 'role_title') IS NOT NULL
BEGIN
    ALTER TABLE dbo.Staff DROP COLUMN role_title;
END
GO

IF COL_LENGTH('dbo.Staff', 'clinic_id') IS NOT NULL
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM sys.check_constraints
        WHERE name = 'CK_Staff_ClinicRequired'
          AND parent_object_id = OBJECT_ID('dbo.Staff')
    )
    BEGIN
        ALTER TABLE dbo.Staff WITH NOCHECK
        ADD CONSTRAINT CK_Staff_ClinicRequired CHECK (clinic_id IS NOT NULL);
    END
END
GO
