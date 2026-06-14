const mongoose = require('mongoose');
const uri = 'mongodb+srv://khayyalmohamed5_db_user:jTkr8WsRq02JK9D5@clynk.zrfavf9.mongodb.net/clynk?retryWrites=true&w=majority&appName=CLYNK';
mongoose.connect(uri).then(async () => {
  const db = mongoose.connection.db;
  const staff = await db.collection('staffs').findOne({ full_name: 'Test Staff' });
  const bookings = await db.collection('bookings').find({ staff_id: staff._id, booking_date: { $regex: '^2026-06' } }).toArray();
  for (const b of bookings) {
    if (b.status === 'cancelled') {
      await db.collection('bookings').updateOne({ _id: b._id }, { $set: { status: 'confirmed' } });
      await db.collection('payments').insertOne({
        booking_id: b._id,
        clinic_id: staff.clinic_id,
        staff_id: staff._id,
        patient_id: b.patient_user_id,
        amount: staff.consultation_price || 150,
        currency: 'EGP',
        split: { staff_amount: (staff.consultation_price || 150) * 0.8, clinic_amount: (staff.consultation_price || 150) * 0.2 },
        status: 'completed',
        created_at: new Date(),
        updated_at: new Date()
      });
      console.log('Updated booking', b._id, 'to confirmed and created payment');
    }
  }
  process.exit(0);
});
