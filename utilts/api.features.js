class APIFeatures {
  constructor(queryString, allowedFields = []) {
    this.queryString = queryString;
    this.allowedFields = allowedFields;

    this.where = [];
    this.values = [];

    this.sortBy = "created_at DESC";
    this.limitValue = 100;
    this.offsetValue = 0;
    this.fields = "*";
  }

  filter() {
    const excludedFields = ["page", "sort", "limit", "fields"];
    const filters = { ...this.queryString };

    excludedFields.forEach((el) => delete filters[el]);

    for (const key in filters) {
      if (!this.allowedFields.includes(key)) continue;

      if (typeof filters[key] === "object") {
        for (const operator in filters[key]) {
          const sqlOp = this._mapOperator(operator);
          if (!sqlOp) continue;

          this.where.push(
            `[${key}] ${sqlOp} ${this._addValue(filters[key][operator])}`,
          );
        }
      } else {
        this.where.push(`[${key}] = ${this._addValue(filters[key])}`);
      }
    }

    return this;
  }

  sort() {
    if (this.queryString.sort) {
      const fields = this.queryString.sort.split(",");

      const safeSort = fields
        .map((f) => {
          const order = f.startsWith("-") ? "DESC" : "ASC";
          const field = f.replace("-", "");

          if (!this.allowedFields.includes(field)) return null;
          return `[${field}] ${order}`;
        })
        .filter(Boolean);

      if (safeSort.length) {
        this.sortBy = safeSort.join(", ");
      }
    }
    return this;
  }

  limitFields() {
    if (this.queryString.fields) {
      const safeFields = this.queryString.fields
        .split(",")
        .filter((f) => this.allowedFields.includes(f));

      if (safeFields.length) {
        this.fields = safeFields.map((f) => `[${f}]`).join(", ");
      }
    }
    return this;
  }

  paginate() {
    const page = Number(this.queryString.page) || 1;
    const limit = Math.min(Number(this.queryString.limit) || 100, 100);

    this.limitValue = limit;
    this.offsetValue = (page - 1) * limit;

    return this;
  }

  build(table) {
    let sql = `SELECT ${this.fields} FROM [${table}]`;

    if (this.where.length) {
      sql += ` WHERE ${this.where.join(" AND ")}`;
    }

    const offsetParam = this._addValue(this.offsetValue);
    const limitParam = this._addValue(this.limitValue);

    sql += ` ORDER BY ${this.sortBy}`;
    sql += ` OFFSET ${offsetParam} ROWS FETCH NEXT ${limitParam} ROWS ONLY`;

    return { sql, values: this.values };
  }

  _mapOperator(op) {
    const map = {
      gte: ">=",
      gt: ">",
      lte: "<=",
      lt: "<",
    };
    return map[op];
  }

  _addValue(value) {
    const paramName = `p${this.values.length}`;
    this.values.push({ name: paramName, value });
    return `@${paramName}`;
  }
}

module.exports = APIFeatures;
