CREATE TABLE dbo.Ratings (
    rating_id INT IDENTITY(1,1) PRIMARY KEY,
    patient_user_id INT NOT NULL,

    doctor_id INT NULL,
    clinic_id INT NULL,
    staff_id INT NULL,

    rating TINYINT NOT NULL
        CHECK (rating BETWEEN 1 AND 5),
    comment NVARCHAR(500) NOT NULL,

    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    updated_at DATETIME2 NULL,

    CONSTRAINT FK_Ratings_Patient
        FOREIGN KEY (patient_user_id)
        REFERENCES dbo.Users(user_id)
        ON DELETE CASCADE,

    CONSTRAINT FK_Ratings_Doctor
        FOREIGN KEY (doctor_id)
        REFERENCES dbo.Doctors(doctor_id)
        ON DELETE NO ACTION,

    CONSTRAINT FK_Ratings_Clinic
        FOREIGN KEY (clinic_id)
        REFERENCES dbo.Clinics(clinic_id)
        ON DELETE NO ACTION,

    CONSTRAINT FK_Ratings_Staff
        FOREIGN KEY (staff_id)
        REFERENCES dbo.Staff(staff_id)
        ON DELETE NO ACTION,

    CONSTRAINT CK_Ratings_Target
        CHECK (
            (doctor_id IS NOT NULL AND clinic_id IS NULL AND staff_id IS NULL)
            OR
            (doctor_id IS NULL AND clinic_id IS NOT NULL AND staff_id IS NULL)
            OR
            (doctor_id IS NULL AND clinic_id IS NULL AND staff_id IS NOT NULL)
        )
);
GO

CREATE UNIQUE INDEX UX_Ratings_Patient_Doctor
ON dbo.Ratings(patient_user_id, doctor_id)
WHERE doctor_id IS NOT NULL;
GO

CREATE UNIQUE INDEX UX_Ratings_Patient_Clinic
ON dbo.Ratings(patient_user_id, clinic_id)
WHERE clinic_id IS NOT NULL;
GO

CREATE UNIQUE INDEX UX_Ratings_Patient_Staff
ON dbo.Ratings(patient_user_id, staff_id)
WHERE staff_id IS NOT NULL;
GO

CREATE INDEX IX_Ratings_Doctor_CreatedAt
ON dbo.Ratings(doctor_id, created_at DESC)
WHERE doctor_id IS NOT NULL;
GO

CREATE INDEX IX_Ratings_Clinic_CreatedAt
ON dbo.Ratings(clinic_id, created_at DESC)
WHERE clinic_id IS NOT NULL;
GO

CREATE INDEX IX_Ratings_Staff_CreatedAt
ON dbo.Ratings(staff_id, created_at DESC)
WHERE staff_id IS NOT NULL;
GO
