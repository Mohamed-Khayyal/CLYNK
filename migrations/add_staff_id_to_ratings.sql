IF COL_LENGTH('dbo.Ratings', 'staff_id') IS NULL
BEGIN
    ALTER TABLE dbo.Ratings
    ADD staff_id INT NULL;
END
GO

IF EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_Ratings_Target'
)
BEGIN
    ALTER TABLE dbo.Ratings
    DROP CONSTRAINT CK_Ratings_Target;
END
GO

ALTER TABLE dbo.Ratings
ADD CONSTRAINT CK_Ratings_Target
CHECK (
    (doctor_id IS NOT NULL AND clinic_id IS NULL AND staff_id IS NULL)
    OR
    (clinic_id IS NOT NULL AND doctor_id IS NULL AND staff_id IS NULL)
    OR
    (staff_id IS NOT NULL AND doctor_id IS NULL AND clinic_id IS NULL)
);
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'FK_Ratings_Staff'
)
BEGIN
    ALTER TABLE dbo.Ratings
    ADD CONSTRAINT FK_Ratings_Staff
        FOREIGN KEY (staff_id)
        REFERENCES dbo.Staff(staff_id)
        ON DELETE NO ACTION;
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'UX_Ratings_Patient_Staff'
      AND object_id = OBJECT_ID('dbo.Ratings')
)
BEGIN
    CREATE UNIQUE INDEX UX_Ratings_Patient_Staff
    ON dbo.Ratings(patient_user_id, staff_id)
    WHERE staff_id IS NOT NULL;
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_Ratings_Staff_CreatedAt'
      AND object_id = OBJECT_ID('dbo.Ratings')
)
BEGIN
    CREATE INDEX IX_Ratings_Staff_CreatedAt
    ON dbo.Ratings(staff_id, created_at DESC)
    WHERE staff_id IS NOT NULL;
END
GO
