IF COL_LENGTH('dbo.Users', 'password_reset_token') IS NULL
BEGIN
    ALTER TABLE dbo.Users
    ADD password_reset_token VARCHAR(64) NULL;
END
GO

IF COL_LENGTH('dbo.Users', 'password_reset_expires') IS NULL
BEGIN
    ALTER TABLE dbo.Users
    ADD password_reset_expires DATETIME2 NULL;
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_Users_PasswordResetToken'
      AND object_id = OBJECT_ID('dbo.Users')
)
BEGIN
    CREATE INDEX IX_Users_PasswordResetToken
    ON dbo.Users(password_reset_token)
    WHERE password_reset_token IS NOT NULL;
END
GO
