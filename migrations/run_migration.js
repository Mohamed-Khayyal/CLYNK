require("dotenv").config();
const { sql, connectDB } = require("../config/db.Config");

async function runMigration() {
  await connectDB();

  const steps = [
    {
      name: "Drop UX_Doctors_LicenseNumber index",
      sql: `
        IF EXISTS (
          SELECT 1 FROM sys.indexes
          WHERE name = 'UX_Doctors_LicenseNumber'
            AND object_id = OBJECT_ID('dbo.Doctors')
        )
        BEGIN
          DROP INDEX UX_Doctors_LicenseNumber ON dbo.Doctors;
          PRINT 'Dropped index UX_Doctors_LicenseNumber';
        END
      `,
    },
    {
      name: "Drop license_number column from Doctors",
      sql: `
        IF COL_LENGTH('dbo.Doctors', 'license_number') IS NOT NULL
        BEGIN
          ALTER TABLE dbo.Doctors DROP COLUMN license_number;
          PRINT 'Dropped column license_number from dbo.Doctors';
        END
      `,
    },
    {
      name: "Add licence column to Doctors",
      sql: `
        IF COL_LENGTH('dbo.Doctors', 'licence') IS NULL
        BEGIN
          ALTER TABLE dbo.Doctors ADD licence VARCHAR(500) NULL;
          PRINT 'Added licence to dbo.Doctors';
        END
      `,
    },
    {
      name: "Add licence column to Staff",
      sql: `
        IF COL_LENGTH('dbo.Staff', 'licence') IS NULL
        BEGIN
          ALTER TABLE dbo.Staff ADD licence VARCHAR(500) NULL;
          PRINT 'Added licence to dbo.Staff';
        END
      `,
    },
    {
      name: "Add licence column to Clinics",
      sql: `
        IF COL_LENGTH('dbo.Clinics', 'licence') IS NULL
        BEGIN
          ALTER TABLE dbo.Clinics ADD licence VARCHAR(500) NULL;
          PRINT 'Added licence to dbo.Clinics';
        END
      `,
    },
  ];

  for (const step of steps) {
    process.stdout.write(`  Running: ${step.name} ... `);
    try {
      await sql.query(step.sql);
      console.log("OK");
    } catch (err) {
      console.log("FAILED:", err.message);
      process.exit(1);
    }
  }

  console.log("\nMigration completed successfully.");
  process.exit(0);
}

runMigration().catch((err) => {
  console.error("Migration error:", err);
  process.exit(1);
});
