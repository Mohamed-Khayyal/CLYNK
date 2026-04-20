CREATE DATABASE CLYNK;
GO
USE CLYNK;
GO

CREATE TABLE dbo.Users (
    user_id INT IDENTITY(1,1) PRIMARY KEY,
    email VARCHAR(150) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    photo VARCHAR(500) NULL,

    user_type VARCHAR(20) NOT NULL
        CHECK (user_type IN ('patient', 'doctor', 'staff', 'admin')),

    is_active BIT NOT NULL DEFAULT 1,
    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME()
);
GO

CREATE INDEX IX_Users_Email ON dbo.Users(email);
GO

CREATE TABLE dbo.Admins (
    admin_id INT IDENTITY(1,1) PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    full_name NVARCHAR(150) NOT NULL,

    CONSTRAINT FK_Admins_Users
        FOREIGN KEY (user_id)
        REFERENCES dbo.Users(user_id)
        ON DELETE CASCADE
);
GO

CREATE TABLE dbo.Clinics (
    clinic_id INT IDENTITY(1,1) PRIMARY KEY,
    owner_user_id INT NOT NULL,
    verified_by_admin_id INT NULL,

    name NVARCHAR(150) NOT NULL UNIQUE,
    address NVARCHAR(255),
    location NVARCHAR(150) NOT NULL,
    phone VARCHAR(20),
    email VARCHAR(150) NOT NULL UNIQUE,

    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),

    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    verified_at DATETIME2 NULL,

    CONSTRAINT FK_Clinics_Owner
        FOREIGN KEY (owner_user_id)
        REFERENCES dbo.Users(user_id),

    CONSTRAINT FK_Clinics_AdminVerifier
        FOREIGN KEY (verified_by_admin_id)
        REFERENCES dbo.Admins(admin_id)
);
GO

CREATE TABLE dbo.Doctors (
    doctor_id INT IDENTITY(1,1) PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,

    full_name NVARCHAR(150) NOT NULL,
    phone VARCHAR(20),
    license_number VARCHAR(50) NOT NULL UNIQUE,
    gender VARCHAR(10),

    specialist NVARCHAR(100) NOT NULL,
    work_days NVARCHAR(100) NOT NULL, -- sun,mon,tue
    work_from TIME NOT NULL,
    work_to TIME NOT NULL,

    location NVARCHAR(150) NULL,
    consultation_price DECIMAL(10,2) NULL,

    is_verified BIT NOT NULL DEFAULT 0,
    years_of_experience TINYINT,
    bio NVARCHAR(500),

    CONSTRAINT FK_Doctors_Users
        FOREIGN KEY (user_id)
        REFERENCES dbo.Users(user_id)
        ON DELETE CASCADE,

    CONSTRAINT CK_Doctors_Specialist
        CHECK (specialist IN (
            N'مخ واعصاب',
            N'عظام',
            N'الأورام',
            N'طب الأذن والأنف والحنجرة',
            N'طب العيون',
            N'قلب و اوعية دموية',
            N'صدر و جهاز تنفسي',
            N'كلى',
            N'اسنان',
            N'اطفال و حديثي الولادة',
            N'جلدية',
            N'نسا و توليد'
        ))
);
GO

CREATE TABLE dbo.Patients (
    patient_id INT IDENTITY(1,1) PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,

    full_name NVARCHAR(150) NOT NULL,
    date_of_birth DATE,
    gender VARCHAR(10),
    phone VARCHAR(20),
    CONSTRAINT FK_Patients_Users
        FOREIGN KEY (user_id)
        REFERENCES dbo.Users(user_id)
        ON DELETE CASCADE
);
GO

CREATE TABLE dbo.Staff (
    staff_id INT IDENTITY(1,1) PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    clinic_id INT NOT NULL,

    full_name NVARCHAR(150) NOT NULL,
    role_title VARCHAR(20) NOT NULL
        CHECK (role_title IN ('doctor', 'nurse', 'receptionist')),

    specialist NVARCHAR(100) NULL,
    work_days NVARCHAR(100) NULL,     -- sun,mon,tue
    work_from TIME NULL,
    work_to TIME NULL,
    consultation_price DECIMAL(10,2) NULL,

    is_verified BIT NOT NULL DEFAULT 0,

    CONSTRAINT FK_Staff_Users
        FOREIGN KEY (user_id)
        REFERENCES dbo.Users(user_id)
        ON DELETE CASCADE,

    CONSTRAINT FK_Staff_Clinics
        FOREIGN KEY (clinic_id)
        REFERENCES dbo.Clinics(clinic_id)
        ON DELETE CASCADE,

    CONSTRAINT CK_Staff_Doctor_Data
        CHECK (
            (
                role_title = 'doctor'
                AND specialist IN (
                    N'مخ واعصاب',
                    N'عظام',
                    N'الأورام',
                    N'طب الأذن والأنف والحنجرة',
                    N'طب العيون',
                    N'قلب و اوعية دموية',
                    N'صدر و جهاز تنفسي',
                    N'كلى',
                    N'اسنان',
                    N'اطفال و حديثي الولادة',
                    N'جلدية',
                    N'نسا و توليد'
                )
                AND work_days IS NOT NULL
                AND work_from IS NOT NULL
                AND work_to IS NOT NULL
                AND consultation_price IS NOT NULL
            )
            OR
            (
                role_title <> 'doctor'
                AND specialist IS NULL
                AND work_days IS NULL
                AND work_from IS NULL
                AND work_to IS NULL
                AND consultation_price IS NULL
            )
        )
);
GO

CREATE TABLE dbo.Bookings (
    booking_id INT IDENTITY(1,1) PRIMARY KEY,

    patient_user_id INT NOT NULL,

    doctor_id INT NULL,
    staff_id INT NULL,

    booking_date DATE NOT NULL,
    booking_from TIME NOT NULL,
    booking_to TIME NOT NULL,

    status VARCHAR(20) NOT NULL DEFAULT 'confirmed'
        CHECK (status IN ('confirmed', 'cancelled')),

    prescription_access_status VARCHAR(20) NOT NULL DEFAULT 'not_requested'
        CHECK (prescription_access_status IN (
            'not_requested',
            'pending',
            'accepted',
            'rejected'
        )),
    prescription_access_requested_at DATETIME2 NULL,
    prescription_access_responded_at DATETIME2 NULL,

    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

    CONSTRAINT FK_Bookings_Patient
        FOREIGN KEY (patient_user_id)
        REFERENCES dbo.Users(user_id),

    CONSTRAINT FK_Bookings_Doctor
        FOREIGN KEY (doctor_id)
        REFERENCES dbo.Doctors(doctor_id),

    CONSTRAINT FK_Bookings_Staff
        FOREIGN KEY (staff_id)
        REFERENCES dbo.Staff(staff_id),

    CONSTRAINT CK_Bookings_Target
        CHECK (
            (doctor_id IS NOT NULL AND staff_id IS NULL)
            OR
            (doctor_id IS NULL AND staff_id IS NOT NULL)
        )
);
GO

CREATE TABLE dbo.Notifications (
    notification_id INT IDENTITY(1,1) PRIMARY KEY,
    user_id INT NOT NULL,

    title NVARCHAR(150) NOT NULL,
    message NVARCHAR(500) NOT NULL,

    is_read BIT NOT NULL DEFAULT 0,
    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

    CONSTRAINT FK_Notifications_Users
        FOREIGN KEY (user_id)
        REFERENCES dbo.Users(user_id)
        ON DELETE CASCADE
);
GO

IF COL_LENGTH('dbo.Patients', 'blood_type') IS NOT NULL
BEGIN
    ALTER TABLE dbo.Patients
    DROP COLUMN blood_type;
END
GO

ALTER TABLE dbo.Clinics
ADD geo_location GEOGRAPHY NULL;
GO

ALTER TABLE dbo.Doctors
ADD geo_location GEOGRAPHY NULL;
GO


CREATE TABLE dbo.Prescriptions (
    prescription_id INT IDENTITY(1,1) PRIMARY KEY,

    booking_id INT NOT NULL,
    patient_id INT NOT NULL,
    doctor_id INT NULL,
    staff_id INT NULL,

    patient_age INT NULL,

    doctor_name NVARCHAR(150) NULL,
    specialty NVARCHAR(100) NULL,
    doctor_emergency_contact VARCHAR(20) NULL,

    visit_date DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    symptoms NVARCHAR(500) NULL,
    diagnosis NVARCHAR(500) NULL,

    medication_name NVARCHAR(150) NULL,
    dose NVARCHAR(100) NULL,
    duration NVARCHAR(100) NULL,

    test_name NVARCHAR(150) NULL,
    test_result NVARCHAR(500) NULL,
    test_date DATE NULL,

    notes NVARCHAR(500) NULL,

    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

    CONSTRAINT FK_Prescriptions_Booking
        FOREIGN KEY (booking_id)
        REFERENCES dbo.Bookings(booking_id),

    CONSTRAINT FK_Prescriptions_Patient
        FOREIGN KEY (patient_id)
        REFERENCES dbo.Patients(patient_id),

    CONSTRAINT FK_Prescriptions_Doctor
        FOREIGN KEY (doctor_id)
        REFERENCES dbo.Doctors(doctor_id),

    CONSTRAINT FK_Prescriptions_Staff
        FOREIGN KEY (staff_id)
        REFERENCES dbo.Staff(staff_id),

    CONSTRAINT CK_Prescriptions_Prescriber
        CHECK (
            (doctor_id IS NOT NULL AND staff_id IS NULL)
            OR
            (doctor_id IS NULL AND staff_id IS NOT NULL)
        )
);
GO

CREATE UNIQUE INDEX UX_Prescriptions_Booking
ON dbo.Prescriptions(booking_id);
GO

CREATE TABLE dbo.PrescriptionPermissions (
    permission_id INT IDENTITY(1,1) PRIMARY KEY,

    patient_user_id INT NOT NULL,
    doctor_id INT NULL,
    staff_id INT NULL,

    status VARCHAR(20) NOT NULL DEFAULT 'accepted'
        CHECK (status IN ('accepted', 'revoked')),

    accepted_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    updated_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

    CONSTRAINT FK_PrescriptionPermissions_Patient
        FOREIGN KEY (patient_user_id)
        REFERENCES dbo.Users(user_id),

    CONSTRAINT FK_PrescriptionPermissions_Doctor
        FOREIGN KEY (doctor_id)
        REFERENCES dbo.Doctors(doctor_id),

    CONSTRAINT FK_PrescriptionPermissions_Staff
        FOREIGN KEY (staff_id)
        REFERENCES dbo.Staff(staff_id),

    CONSTRAINT CK_PrescriptionPermissions_Target
        CHECK (
            (doctor_id IS NOT NULL AND staff_id IS NULL)
            OR
            (doctor_id IS NULL AND staff_id IS NOT NULL)
        )
);
GO

CREATE UNIQUE INDEX UX_PrescriptionPermissions_PatientDoctor
ON dbo.PrescriptionPermissions(patient_user_id, doctor_id)
WHERE doctor_id IS NOT NULL;
GO

CREATE UNIQUE INDEX UX_PrescriptionPermissions_PatientStaff
ON dbo.PrescriptionPermissions(patient_user_id, staff_id)
WHERE staff_id IS NOT NULL;
GO
