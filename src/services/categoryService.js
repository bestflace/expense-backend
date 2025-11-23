// src/services/categoryService.js
const pool = require("../db");

// Map 1 row DB -> object gửi về FE
function mapCategoryRow(row) {
  return {
    id: row.category_id,
    name: row.category_name,
    type: row.type, // 'income' | 'expense'
    icon: row.icon,
    color: row.color,
    parentCategoryId: row.parent_category_id,
    isGlobal: row.user_id === null,
  };
}

/**
 * Lấy tất cả categories user được thấy:
 * - Global (user_id IS NULL)
 * - Category riêng của user
 * Optional filter by type
 */
async function getCategories(userId, type) {
  const params = [userId];
  let whereType = "";

  if (type === "income" || type === "expense") {
    params.push(type);
    whereType = "AND c.type = $2";
  }

  const sql = `
    SELECT c.*
    FROM categories c
    WHERE (c.user_id IS NULL OR c.user_id = $1)
      ${whereType}
    ORDER BY 
      c.type,
      c.parent_category_id NULLS FIRST,
      lower(c.category_name)
  `;

  const { rows } = await pool.query(sql, params);
  return rows.map(mapCategoryRow);
}

/**
 * Thêm category mới cho user
 */
async function createCategory(userId, payload) {
  let { name, type, icon, color, parentCategoryId } = payload;

  name = name?.trim();
  if (!name) {
    const err = new Error("Tên danh mục là bắt buộc");
    err.status = 400;
    throw err;
  }

  if (type !== "income" && type !== "expense") {
    const err = new Error("Loại danh mục không hợp lệ (income/expense)");
    err.status = 400;
    throw err;
  }

  // Nếu có parentCategoryId -> kiểm tra parent thuộc user hoặc global
  let parentId = null;
  if (parentCategoryId != null) {
    parentId = Number(parentCategoryId);
    if (Number.isNaN(parentId)) {
      const err = new Error("parentCategoryId không hợp lệ");
      err.status = 400;
      throw err;
    }

    const { rows: pRows } = await pool.query(
      `SELECT category_id, user_id, type 
       FROM categories 
       WHERE category_id = $1`,
      [parentId]
    );

    if (pRows.length === 0) {
      const err = new Error("Danh mục cha không tồn tại");
      err.status = 404;
      throw err;
    }

    const parent = pRows[0];
    if (parent.type !== type) {
      const err = new Error(
        "Loại danh mục con phải trùng với danh mục cha (income/expense)"
      );
      err.status = 400;
      throw err;
    }

    // Trigger trong DB đã check scope parent/user; ở service chỉ cảnh báo nhẹ
  }

  const sql = `
    INSERT INTO categories (
      user_id, category_name, type, icon, color, parent_category_id
    )
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING *
  `;

  const { rows } = await pool.query(sql, [
    userId,
    name,
    type,
    icon || null,
    color || null,
    parentId,
  ]);

  return mapCategoryRow(rows[0]);
}

/**
 * Cập nhật category của user
 */
async function updateCategory(userId, categoryId, updates) {
  categoryId = Number(categoryId);
  if (Number.isNaN(categoryId)) {
    const err = new Error("ID danh mục không hợp lệ");
    err.status = 400;
    throw err;
  }

  // Lấy category hiện tại
  const { rows: existedRows } = await pool.query(
    `
      SELECT *
      FROM categories
      WHERE category_id = $1
    `,
    [categoryId]
  );

  if (existedRows.length === 0) {
    const err = new Error("Không tìm thấy danh mục");
    err.status = 404;
    throw err;
  }

  const current = existedRows[0];

  // Không cho update category global
  if (current.user_id === null) {
    const err = new Error("Không thể chỉnh sửa danh mục mặc định (global)");
    err.status = 403;
    throw err;
  }

  // Không cho user khác sửa
  if (current.user_id !== userId) {
    const err = new Error("Bạn không có quyền chỉnh sửa danh mục này");
    err.status = 403;
    throw err;
  }

  let newName =
    updates.name != null ? updates.name.trim() : current.category_name;
  let newType = updates.type || current.type;
  let newIcon = updates.icon != null ? updates.icon : current.icon;
  let newColor = updates.color != null ? updates.color : current.color;

  if (!newName) {
    const err = new Error("Tên danh mục không được để trống");
    err.status = 400;
    throw err;
  }

  if (newType !== "income" && newType !== "expense") {
    const err = new Error("Loại danh mục không hợp lệ");
    err.status = 400;
    throw err;
  }

  const sql = `
    UPDATE categories
    SET category_name = $1,
        type          = $2,
        icon          = $3,
        color         = $4,
        updated_at    = now()
    WHERE category_id = $5 AND user_id = $6
    RETURNING *
  `;

  const { rows } = await pool.query(sql, [
    newName,
    newType,
    newIcon,
    newColor,
    categoryId,
    userId,
  ]);

  return mapCategoryRow(rows[0]);
}

/**
 * Xóa category:
 *  - chỉ cho xóa category thuộc user
 *  - global không cho xóa
 *  - không được có giao dịch dính tới category này hoặc con của nó
 *  - nếu ok: xóa subcategory trước, rồi xóa parent
 */
async function deleteCategory(userId, categoryId) {
  categoryId = Number(categoryId);
  if (Number.isNaN(categoryId)) {
    const err = new Error("ID danh mục không hợp lệ");
    err.status = 400;
    throw err;
  }

  // Lấy category
  const { rows: existedRows } = await pool.query(
    `SELECT * FROM categories WHERE category_id = $1`,
    [categoryId]
  );

  if (existedRows.length === 0) {
    const err = new Error("Không tìm thấy danh mục");
    err.status = 404;
    throw err;
  }

  const cat = existedRows[0];

  if (cat.user_id === null) {
    const err = new Error("Không thể xóa danh mục mặc định (global)");
    err.status = 403;
    throw err;
  }

  if (cat.user_id !== userId) {
    const err = new Error("Bạn không có quyền xóa danh mục này");
    err.status = 403;
    throw err;
  }

  // Tìm tất cả subcategory trực tiếp
  const { rows: subRows } = await pool.query(
    `SELECT category_id FROM categories WHERE parent_category_id = $1`,
    [categoryId]
  );
  const subIds = subRows.map((r) => r.category_id);

  const allIds = [categoryId, ...subIds];

  // Kiểm tra giao dịch dính tới các category này
  const { rows: txRows } = await pool.query(
    `
      SELECT 1 
      FROM transactions 
      WHERE user_id = $1
        AND category_id = ANY($2::bigint[])
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [userId, allIds]
  );

  if (txRows.length > 0) {
    const err = new Error(
      "Không thể xóa danh mục vì đang có giao dịch liên quan. Vui lòng xóa giao dịch hoặc chuyển danh mục trước."
    );
    err.status = 400;
    throw err;
  }

  // Xóa subcategory trước
  if (subIds.length > 0) {
    await pool.query(
      `DELETE FROM categories 
       WHERE parent_category_id = $1 
         AND user_id = $2`,
      [categoryId, userId]
    );
  }

  // Xóa parent
  await pool.query(
    `DELETE FROM categories 
     WHERE category_id = $1 
       AND user_id = $2`,
    [categoryId, userId]
  );

  return true;
}

module.exports = {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
};
