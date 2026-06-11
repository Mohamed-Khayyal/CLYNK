const catchAsync = require("../utilts/catch.Async");
const AppError = require("../utilts/app.Error");
const Notification = require("../models/Notification.model");
const mongoose = require("mongoose");

const parseId = (value) => {
  if (!value || !mongoose.Types.ObjectId.isValid(value)) return null;
  return value;
};

exports.getMyNotifications = catchAsync(async (req, res, next) => {
  const userId = req.user.user_id;

  const notifications = await Notification.find({ user_id: userId })
    .sort({ created_at: -1 })
    .lean();

  res.status(200).json({
    status: "success",
    results: notifications.length,
    notifications: notifications.map((n) => ({
      notification_id: n._id,
      title: n.title,
      message: n.message,
      is_read: n.is_read,
    })),
  });
});

exports.markAsRead = catchAsync(async (req, res, next) => {
  const notificationId = parseId(req.params.id);
  if (!notificationId) return next(new AppError("Invalid notification id", 400));
  const userId = req.user.user_id;

  await Notification.findOneAndUpdate(
    { _id: notificationId, user_id: userId },
    { is_read: true }
  );

  res.status(200).json({
    status: "success",
    message: "تم تعليم الإشعار كمقروء",
  });
});
