require('dotenv').config({ path: 'c:/Projects/Clynk/.env' });
const mongoose = require('mongoose');
const { getAuditLogs } = require('./utilts/audit.Logger');

async function run() {
  await mongoose.connect(process.env.DATABASE_URL);
  
  const statsLogs = await getAuditLogs({ limit: 100000 });
  console.log('Stats Logs count:', statsLogs.length);
  
  const listLogs = await getAuditLogs({
    limit: 1000,
    level: undefined,
    actor_user_id: undefined,
    actor_role: undefined,
    method: undefined,
    status_code: undefined,
    path_contains: undefined,
    location_contains: undefined,
  });
  console.log('List Logs count:', listLogs.length);
  
  process.exit(0);
}
run();
