const Notification = require("../models/Notification.model");

exports.createNotification = async ({ user_id, title, message }) => {
  await Notification.create({ user_id, title, message });
};
