USE CLYNK;
GO

DECLARE @constraintName SYSNAME;
DECLARE @sql NVARCHAR(MAX);

SELECT TOP 1 @constraintName = cc.name
FROM sys.check_constraints cc
JOIN sys.tables t
    ON t.object_id = cc.parent_object_id
JOIN sys.schemas s
    ON s.schema_id = t.schema_id
WHERE s.name = 'dbo'
  AND t.name = 'Users'
  AND cc.definition LIKE '%user_type%';

IF @constraintName IS NOT NULL
BEGIN
    SET @sql = N'ALTER TABLE dbo.Users DROP CONSTRAINT [' + @constraintName + ']';
    EXEC sp_executesql @sql;
END;
GO

ALTER TABLE dbo.Users
ADD CONSTRAINT CK_Users_UserType
CHECK (user_type IN ('patient', 'doctor', 'staff', 'clinic', 'admin'));
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'UX_Clinics_OwnerUser'
      AND object_id = OBJECT_ID('dbo.Clinics')
)
BEGIN
    CREATE UNIQUE INDEX UX_Clinics_OwnerUser
    ON dbo.Clinics(owner_user_id);
END
GO
