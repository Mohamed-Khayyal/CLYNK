const multer = require("multer");
const cloudinary = require("../config/cloudinary");
const catchAsync = require("../utilts/catch.Async");
const AppError = require("../utilts/app.Error");

const multerStorage = multer.memoryStorage();

// Accept images and PDFs only
const multerFilter = (req, file, cb) => {
  if (
    file.mimetype.startsWith("image") ||
    file.mimetype === "application/pdf"
  ) {
    cb(null, true);
  } else {
    cb(new AppError("Only image files and PDFs are allowed", 400), false);
  }
};

const upload = multer({
  storage: multerStorage,
  fileFilter: multerFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
  },
});

exports.uploadSingle = (field) => upload.single(field);

exports.uploadFields = (fields) => upload.fields(fields);

const uploadBufferToCloudinary = async (file, folder) => {
  const isPdf = file.mimetype === "application/pdf";
  const uniqueId = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;

  const uploadOptions = {
    folder,
    resource_type: "image",
    public_id: uniqueId,
    ...(isPdf
      ? {}
      : {
          transformation: [
            { quality: "auto" },
            { fetch_format: "auto" },
          ],
        }),
  };

  return cloudinary.uploader.upload(
    `data:${file.mimetype};base64,${file.buffer.toString("base64")}`,
    uploadOptions
  );
};

exports.uploadToCloudinary = catchAsync(async (req, res, next) => {
  if (!req.file && (!req.files || Object.keys(req.files).length === 0)) {
    return next();
  }

  const folderMap = {
    photo: "CLYNK/photos",
    licence: "CLYNK/licences",
  };

  if (req.file) {
    const field = req.file.fieldname;
    const folder = folderMap[field] || "CLYNK/photos";

    const result = await uploadBufferToCloudinary(req.file, folder);

    req.body[field] = result.secure_url;
  }

  if (req.files) {
    for (const fieldName of Object.keys(req.files)) {
      const files = req.files[fieldName];
      if (!files || !files.length) continue;

      const folder = folderMap[fieldName] || "CLYNK/photos";

      const uploads = [];

      for (const file of files) {
        const result = await uploadBufferToCloudinary(file, folder);
        uploads.push(result.secure_url);
      }

      req.body[fieldName] = uploads.length === 1 ? uploads[0] : uploads;
    }
  }

  next();
});
